import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Identity } from '../../app/auth';
import {
  fetchAudio,
  isAdmin,
  loadAnnotations,
  newAnnotationRow,
  saveAnnotation,
  saveThread,
  type AnnotationDoc,
  type Content,
  type RecordingEntry,
  type TeamEntry,
} from '../../app/teams';
import { backend } from '../../backend';
import type { PublicProfile, Visibility } from '../../backend/types';
import { AudioEngine, type Analysis } from '../../dsp/engine';
import { Icon, type IconName } from '../Icon';
import { t } from '../../i18n';
import {
  emptyIntervalTier,
  emptyPointTier,
  intervalsOf,
  removeBoundary,
  addBoundary,
  intervalIndexAt,
  anchorLabel,
  sameAnchor,
  type Anchor,
  type IntervalTier,
  type Shape,
  type Sketch,
  type TagDef,
  type TagItem,
  type TagSet,
  type Thread,
  type Tier,
} from '../../model';
import { parseTextGrid, writeTextGrid } from '../../textgrid';
import { downloadBlob, downloadText } from '../../lib/download';
import { annotatorColor } from '../colors';
import { AgreementPanel } from './AgreementPanel';
import { IpaKeyboard } from './IpaKeyboard';
import { MeasuresPanel, intervalReportCsv, measuresCsv } from './MeasuresPanel';
import { NotesPanel } from './NotesPanel';
import { TiersPanel } from './TiersPanel';
import { GUTTER, Timeline, type LaneItem } from './Timeline';
import { TagsPanel, type TagEntry } from './TagsPanel';
import { ThreadsPanel } from './ThreadsPanel';
import { HistoryDialog } from '../HistoryDialog';
import { disagreementStrip } from '../../agreement/strip';
import { nominalDistance, phoneticDistance } from '../../ipa/distance';
import { formatTime } from '../../lib/format';
import type {
  AgreementConfig,
  Layers,
  PitchRange,
  Selected,
  Selection,
  SketchModel,
  SpectrogramSettings,
  TierModel,
  Tool,
  ViewRange,
} from './types';

/** Where to go when the editor opens (from a notification or a guideline reference). */
export interface EditorTarget {
  anchor: Anchor;
  threadId?: string;
}

interface Props {
  identity: Identity;
  team: TeamEntry;
  recording: RecordingEntry;
  onClose: () => void;
  target: EditorTarget | null;
  tagDefs: TagDef[];
  onAddTagDef: (name: string) => void;
  onCite: (anchor: Anchor) => void;
  /** Messages the user has now seen (clears their notifications). */
  onSeen: (messageIds: string[]) => void;
}

type Panel = 'tiers' | 'measures' | 'notes' | 'tags' | 'threads' | 'agreement';
type SaveState = 'saved' | 'saving' | 'error';

const isTier = (d: AnnotationDoc): d is AnnotationDoc<Tier> => d.row.kind === 'tier';
const isSketch = (d: AnnotationDoc): d is AnnotationDoc<Sketch> => d.row.kind === 'sketch';
const isTags = (d: AnnotationDoc): d is AnnotationDoc<TagSet> => d.row.kind === 'tags';
const isThread = (d: AnnotationDoc): d is AnnotationDoc<Thread> => d.row.kind === 'thread';

const PLAY_ON_CLICK_KEY = 'annotino.playOnClick';

export function Editor({ identity, team, recording: initialRecording, onClose, target, tagDefs, onAddTagDef, onCite, onSeen }: Props) {
  const me = identity.session.userId;
  const [recording, setRecording] = useState(initialRecording);
  const [engine, setEngine] = useState<AudioEngine | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [docs, setDocs] = useState<AnnotationDoc[]>([]);
  const [profiles, setProfiles] = useState<PublicProfile[]>([]);
  const [view, setView] = useState<ViewRange>({ t0: 0, t1: initialRecording.meta.duration });
  const [cursor, setCursor] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [selectedShape, setSelectedShape] = useState<string | null>(null);
  /** The tier that a selected time range gets labelled on (the last tier clicked). */
  const [activeTierId, setActiveTierId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [layers, setLayers] = useState<Layers>({ pitch: true, formants: true, intensity: false, rate: false });
  const [spec, setSpec] = useState<SpectrogramSettings>({ maxFrequency: 5000, windowLength: 0.005, dynamicRange: 50 });
  const [pitchRange, setPitchRange] = useState<PitchRange>({ min: 75, max: 500 });
  const [specHeight, setSpecHeight] = useState(300);
  const [panel, setPanel] = useState<Panel>('tiers');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [agreementConfig, setAgreementConfig] = useState<AgreementConfig | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [menu, setMenu] = useState<'file' | 'analysis' | null>(null);
  const [playOnClick, setPlayOnClick] = useState(() => localStorage.getItem(PLAY_ON_CLICK_KEY) !== 'false');
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set());
  const [tagFocus, setTagFocus] = useState(false);
  const [openThread, setOpenThread] = useState<string | null>(target?.threadId ?? null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const playQueue = useRef<[number, number][]>([]);
  const playhead = useRef<HTMLDivElement>(null);
  const wantLabelFocus = useRef(false);
  const labelInput = useRef<HTMLInputElement>(null);
  const canvasRefs = useRef(new Map<string, HTMLCanvasElement>());
  const saveTimers = useRef(new Map<string, number>());
  const docsRef = useRef(docs);
  docsRef.current = docs;
  const duration = engine?.duration ?? recording.meta.duration;

  // ------------------------------------------------------------ loading
  useEffect(() => {
    let disposed = false;
    let eng: AudioEngine | null = null;
    (async () => {
      try {
        const bytes = await fetchAudio(team, recording.row);
        eng = await AudioEngine.decode(bytes);
        if (disposed) return eng.dispose();
        eng.onPlaybackEnd = () => {
          // Play the next part of a sequence (tagged parts), if any.
          const next = playQueue.current.shift();
          if (next && eng) {
            eng.play(next[0], next[1]);
            setSelection({ a: next[0], b: next[1] });
          } else setPlaying(false);
        };
        setEngine(eng);
        setView({ t0: 0, t1: eng.duration });
      } catch (e) {
        setLoadError(t('The recording could not be opened: {msg}', { msg: (e as Error).message }));
      }
    })();
    return () => {
      disposed = true;
      eng?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team, recording.row.id]);

  useEffect(() => {
    if (!engine) return;
    let cancelled = false;
    setAnalysis(null);
    engine
      .analyse({ minPitch: pitchRange.min, maxPitch: pitchRange.max }, { maxFrequency: spec.maxFrequency >= 5500 ? 5500 : 5000 })
      .then((a) => !cancelled && setAnalysis(a))
      .catch((e) => setLoadError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [engine, pitchRange.min, pitchRange.max, spec.maxFrequency]);

  const reloadAnnotations = useCallback(async () => {
    const fresh = await loadAnnotations(team, recording.row.id);
    setDocs((cur) => {
      // Take the server's version of everything, except documents with edits still waiting to be saved.
      const pending = saveTimers.current;
      const local = new Map(cur.map((d) => [d.row.id, d]));
      const freshIds = new Set(fresh.map((d) => d.row.id));
      const merged = fresh.map((d) => (pending.has(d.row.id) ? (local.get(d.row.id) ?? d) : d));
      const unsaved = cur.filter((d) => !freshIds.has(d.row.id) && pending.has(d.row.id));
      return [...merged, ...unsaved];
    });
  }, [team, recording.row.id, me]);

  useEffect(() => {
    reloadAnnotations().catch((e) => setLoadError(String(e)));
    backend.teamProfiles(team.team.id).then(setProfiles).catch(() => {});
    const id = window.setInterval(() => void reloadAnnotations().catch(() => {}), 30_000);
    return () => window.clearInterval(id);
  }, [reloadAnnotations, team.team.id]);

  // ------------------------------------------------------------ saving
  const flushSave = useCallback(
    async (id: string) => {
      saveTimers.current.delete(id);
      const doc = docsRef.current.find((d) => d.row.id === id);
      if (!doc) return;
      setSaveState('saving');
      try {
        if (isThread(doc)) {
          // Merge with replies posted meanwhile by colleagues.
          const saved = await saveThread(team, doc);
          setDocs((cur) => cur.map((d) => (d.row.id === id ? saved : d)));
          docsRef.current = docsRef.current.map((d) => (d.row.id === id ? saved : d));
        } else {
          const row = await saveAnnotation(team, doc);
          setDocs((cur) => cur.map((d) => (d.row.id === id ? { ...d, row: { ...d.row, updated_at: row.updated_at, payload_enc: row.payload_enc } } : d)));
        }
        if (saveTimers.current.size === 0) setSaveState('saved');
        setSaveError(null);
      } catch (e) {
        setSaveState('error');
        setSaveError((e as Error).message);
      }
    },
    [team],
  );

  const scheduleSave = useCallback(
    (id: string, delay = backend.saveDelayMs ?? 700) => {
      const timers = saveTimers.current;
      const prev = timers.get(id);
      if (prev) window.clearTimeout(prev);
      setSaveState('saving');
      timers.set(id, window.setTimeout(() => void flushSave(id), delay));
    },
    [flushSave],
  );

  // Save pending edits before leaving.
  useEffect(() => {
    const timers = saveTimers.current;
    return () => {
      for (const id of timers.keys()) void flushSave(id);
    };
  }, [flushSave]);

  const updateDoc = useCallback(
    (id: string, content: Content, rowPatch: Partial<AnnotationDoc['row']> = {}) => {
      setDocs((cur) => cur.map((d) => (d.row.id === id ? { row: { ...d.row, ...rowPatch }, content } : d)));
      docsRef.current = docsRef.current.map((d) => (d.row.id === id ? { row: { ...d.row, ...rowPatch }, content } : d));
      scheduleSave(id);
    },
    [scheduleSave],
  );

  // ------------------------------------------------------------ models
  const order = useMemo(() => {
    const ids = profiles.map((p) => p.id).sort();
    return [me, ...ids.filter((id) => id !== me)];
  }, [profiles, me]);
  const nameOf = useCallback(
    (id: string) => (id === me ? t('You') : (profiles.find((p) => p.id === id)?.display_name ?? t('Former member'))),
    [profiles, me],
  );

  const tierModels: TierModel[] = useMemo(
    () =>
      docs.filter(isTier).map((doc) => ({
        doc,
        editable: doc.row.author_id === me,
        color: annotatorColor(doc.row.author_id, order),
        author: nameOf(doc.row.author_id),
      })),
    [docs, me, order, nameOf],
  );
  const visibleTiers = tierModels.filter((m) => !hidden.has(m.doc.row.id));

  // The disagreement strip follows the tiers as they are edited.
  const deferredTiers = useDeferredValue(visibleTiers);
  const strip = useMemo(() => {
    const c = agreementConfig;
    if (!c || c.type !== 'interval') return null;
    const ts = c.tierIds
      .map((id) => deferredTiers.find((m) => m.doc.row.id === id)?.doc.content)
      .filter((x): x is IntervalTier => x?.type === 'interval');
    if (ts.length < 2) return null;
    return disagreementStrip(ts, duration, {
      frameStep: c.frameMs / 1000,
      gapsAsCategory: c.gaps,
      distance: c.labelMode === 'phonetic' ? phoneticDistance : nominalDistance,
      tolerance: c.toleranceMs / 1000,
    });
  }, [agreementConfig, deferredTiers, duration]);
  const sketchModels: SketchModel[] = useMemo(
    () =>
      docs
        .filter(isSketch)
        .filter((d) => !hidden.has(d.row.id))
        .map((doc) => ({ doc, editable: doc.row.author_id === me, color: annotatorColor(doc.row.author_id, order), author: nameOf(doc.row.author_id) })),
    [docs, me, order, nameOf, hidden],
  );

  const defaultVisibility: Visibility = team.team.settings.defaultVisibility;

  const createDoc = (kind: AnnotationDoc['row']['kind'], visibility: Visibility, content: Content) => {
    const row = newAnnotationRow(team, identity, recording.row.id, kind, visibility);
    const doc: AnnotationDoc = { row, content };
    setDocs((cur) => [...cur, doc]);
    docsRef.current = [...docsRef.current, doc];
    scheduleSave(row.id, 0);
    return doc;
  };

  const addTier = (name: string, type: 'interval' | 'point', content?: Tier) => {
    const row = newAnnotationRow(team, identity, recording.row.id, 'tier', defaultVisibility);
    if (defaultVisibility === 'scheduled') row.reveal_at = new Date(Date.now() + 7 * 86400_000).toISOString();
    const tier = content ?? (type === 'interval' ? emptyIntervalTier(name) : emptyPointTier(name));
    const doc: AnnotationDoc = { row, content: tier };
    setDocs((cur) => [...cur, doc]);
    docsRef.current = [...docsRef.current, doc];
    scheduleSave(row.id, 0);
    return row.id;
  };

  const mySketch = docs.find((d): d is AnnotationDoc<Sketch> => isSketch(d) && d.row.author_id === me);

  const commitShape = (shape: Shape) => {
    if (mySketch) {
      updateDoc(mySketch.row.id, { shapes: [...mySketch.content.shapes, shape] });
    } else {
      createDoc('sketch', defaultVisibility === 'private' ? 'private' : 'team', { shapes: [shape] });
    }
    setSelectedShape(shape.id);
    if (shape.kind !== 'text') setTool('select');
    setPanel('notes');
    if (shape.kind === 'text') {
      // Type the text straight away in the drawings panel.
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(`[data-shape="${shape.id}"]`)?.focus());
    }
  };

  const deleteShape = (id: string) => {
    if (!mySketch) return;
    updateDoc(mySketch.row.id, { shapes: mySketch.content.shapes.filter((s) => s.id !== id) });
    if (selectedShape === id) setSelectedShape(null);
  };

  // ------------------------------------------------------------ tags and discussions
  const tagDocs = docs.filter(isTags).filter((d) => !hidden.has(d.row.id));
  const myTags = docs.find((d): d is AnnotationDoc<TagSet> => isTags(d) && d.row.author_id === me);
  const tagEntries: TagEntry[] = tagDocs.flatMap((d) =>
    d.content.items.map((item) => ({
      item,
      author: nameOf(d.row.author_id),
      color: annotatorColor(d.row.author_id, order),
      mine: d.row.author_id === me,
    })),
  );
  const threads = docs.filter(isThread);
  const defById = new Map(tagDefs.map((d) => [d.id, d]));

  const allShapes = sketchModels.flatMap((m) => m.doc.content.shapes);

  // ------------------------------------------------------------ selection helpers
  const selModel = selected ? tierModels.find((m) => m.doc.row.id === selected.docId) : undefined;
  const selLabel: { value: string; editable: boolean; start: number; end?: number } | null = (() => {
    if (!selected || !selModel) return null;
    const tier = selModel.doc.content;
    if (selected.type === 'interval' && tier.type === 'interval') {
      const iv = intervalsOf(tier, duration)[selected.index];
      return iv ? { value: iv.label, editable: selModel.editable, start: iv.start, end: iv.end } : null;
    }
    if (selected.type === 'point' && tier.type === 'point') {
      const p = tier.points[selected.index];
      return p ? { value: p.label, editable: selModel.editable, start: p.t } : null;
    }
    return null;
  })();

  useEffect(() => {
    if (selected) setActiveTierId(selected.docId);
  }, [selected]);

  // A time range selected on the signal can be labelled directly on the active interval tier:
  // typing creates boundaries at both edges of the range.
  const activeModel =
    tierModels.find((m) => m.doc.row.id === activeTierId && m.editable && m.doc.content.type === 'interval' && !hidden.has(m.doc.row.id)) ??
    tierModels.find((m) => m.editable && m.doc.content.type === 'interval' && !hidden.has(m.doc.row.id));
  const rangeTarget = !selLabel && selection && selection.b - selection.a > 1e-3 && activeModel ? { model: activeModel, ...selection } : null;

  const splitAtRange = (target: NonNullable<typeof rangeTarget>, label: string | null) => {
    let tier = target.model.doc.content as IntervalTier;
    tier = addBoundary(tier, target.a, duration);
    tier = addBoundary(tier, target.b, duration);
    const index = intervalIndexAt(tier, (target.a + target.b) / 2);
    if (label !== null) {
      const labels = tier.labels.slice();
      labels[index] = label;
      tier = { ...tier, labels };
    }
    updateDoc(target.model.doc.row.id, tier);
    setSelected({ docId: target.model.doc.row.id, type: 'interval', index });
  };

  /** What a tag, a discussion or a citation applies to right now. */
  const currentTarget: { anchor: Anchor; description: string } | null = (() => {
    const rid = recording.row.id;
    const shape = selectedShape ? allShapes.find((x) => x.id === selectedShape) : undefined;
    if (shape) {
      const ts = shape.points.map((q) => q[0]);
      const fs = shape.points.map((q) => q[1]);
      const anchor: Anchor = {
        recordingId: rid,
        t0: Math.min(...ts),
        t1: Math.max(...ts),
        f0: Math.min(...fs),
        f1: Math.max(...fs),
        shapeId: shape.id,
        label: shape.note || undefined,
      };
      return { anchor, description: t('Drawing: {where}', { where: anchorLabel(anchor, (x) => formatTime(x, 3)) }) };
    }
    if (selLabel && selModel) {
      // Discussions and tags may be seen by others: do not copy the label of a tier they cannot see yet.
      const shareable = selModel.doc.row.visibility === 'team';
      const anchor: Anchor = {
        recordingId: rid,
        t0: selLabel.start,
        t1: selLabel.end ?? selLabel.start,
        tierName: selModel.doc.content.name,
        label: shareable ? selLabel.value || undefined : undefined,
      };
      return {
        anchor,
        description: t('{kind} on “{tier}”: {where}', {
          kind: selLabel.end !== undefined ? t('Interval') : t('Point'),
          tier: selModel.doc.content.name,
          where: anchorLabel(anchor, (x) => formatTime(x, 3)),
        }),
      };
    }
    if (selection && selection.b - selection.a > 1e-3) {
      const anchor: Anchor = { recordingId: rid, t0: selection.a, t1: selection.b };
      return { anchor, description: t('Stretch: {where}', { where: anchorLabel(anchor, (x) => formatTime(x, 3)) }) };
    }
    return null;
  })();

  const toggleTag = (tagId: string) => {
    if (!currentTarget) return;
    const anchor = currentTarget.anchor;
    const items = myTags?.content.items ?? [];
    const existing = items.find((it) => sameAnchor(it.anchor, anchor));
    let next: TagItem[];
    if (existing) {
      const tags = existing.tags.includes(tagId) ? existing.tags.filter((x) => x !== tagId) : [...existing.tags, tagId];
      next = tags.length ? items.map((it) => (it === existing ? { ...it, anchor, tags } : it)) : items.filter((it) => it !== existing);
    } else {
      next = [...items, { id: crypto.randomUUID(), anchor, tags: [tagId] }];
    }
    if (myTags) updateDoc(myTags.row.id, { items: next });
    else createDoc('tags', defaultVisibility === 'private' ? 'private' : defaultVisibility === 'blind' ? 'blind' : 'team', { items: next });
  };

  const createThread = (text: string, mentions: string[]) => {
    if (!currentTarget) return;
    const msg = { id: crypto.randomUUID(), author: me, at: new Date().toISOString(), text, mentions };
    const doc = createDoc('thread', 'team', { anchor: currentTarget.anchor, status: 'open', messages: [msg] } satisfies Thread);
    setOpenThread(doc.row.id);
  };

  const replyThread = (id: string, text: string, mentions: string[]) => {
    const d = threads.find((x) => x.row.id === id);
    if (!d) return;
    const msg = { id: crypto.randomUUID(), author: me, at: new Date().toISOString(), text, mentions };
    updateDoc(id, { ...d.content, messages: [...d.content.messages, msg] });
  };

  const setThreadStatus = (id: string, status: Thread['status']) => {
    const d = threads.find((x) => x.row.id === id);
    if (d) updateDoc(id, { ...d.content, status });
  };

  // Mark the messages of an opened discussion as seen.
  useEffect(() => {
    const d = threads.find((x) => x.row.id === openThread);
    if (d) onSeen(d.content.messages.map((m) => m.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openThread, threads.find((x) => x.row.id === openThread)?.content.messages.length]);

  // Focus the label field once the newly selected item has rendered (the field is disabled before).
  useEffect(() => {
    if (wantLabelFocus.current && selLabel?.editable) {
      wantLabelFocus.current = false;
      labelInput.current?.focus();
    }
  });

  const setLabel = (value: string) => {
    if (rangeTarget) return splitAtRange(rangeTarget, value);
    if (!selected || !selModel?.editable) return;
    const tier = selModel.doc.content;
    if (tier.type === 'interval' && selected.type === 'interval') {
      const labels = tier.labels.slice();
      labels[selected.index] = value;
      updateDoc(selModel.doc.row.id, { ...tier, labels });
    } else if (tier.type === 'point' && selected.type === 'point') {
      const points = tier.points.slice();
      points[selected.index] = { ...points[selected.index], label: value };
      updateDoc(selModel.doc.row.id, { ...tier, points });
    }
  };

  const insertText = (text: string) => {
    const el = labelInput.current;
    if (!el || !(selLabel?.editable || rangeTarget)) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    setLabel(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  };

  // ------------------------------------------------------------ playback
  const play = useCallback(
    (from?: number, to?: number) => {
      if (!engine) return;
      if (engine.playing) {
        engine.stop();
        setPlaying(false);
        return;
      }
      const a = from ?? (selection ? selection.a : cursor > view.t0 && cursor < view.t1 ? cursor : view.t0);
      const b = to ?? (selection ? selection.b : view.t1);
      engine.play(a, b);
      setPlaying(true);
    },
    [engine, selection, cursor, view],
  );

  useEffect(() => {
    if (!playing || !engine) {
      if (playhead.current) playhead.current.style.display = 'none';
      return;
    }
    let raf = 0;
    const tick = () => {
      const p = engine.position();
      const el = playhead.current;
      if (el && p !== null) {
        const frac = (p - view.t0) / (view.t1 - view.t0);
        el.style.display = frac >= 0 && frac <= 1 ? 'block' : 'none';
        el.style.left = `${frac * 100}%`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, engine, view]);

  // ------------------------------------------------------------ zoom
  const zoomTo = useCallback(
    (t0: number, t1: number) => {
      const span = Math.max(0.01, Math.min(duration, t1 - t0));
      const a = Math.max(0, Math.min(duration - span, t0));
      setView({ t0: a, t1: a + span });
    },
    [duration],
  );
  const zoomBy = useCallback(
    (factor: number) => {
      const centre = selection ? (selection.a + selection.b) / 2 : cursor >= view.t0 && cursor <= view.t1 ? cursor : (view.t0 + view.t1) / 2;
      const span = (view.t1 - view.t0) * factor;
      zoomTo(centre - span / 2, centre + span / 2);
    },
    [selection, cursor, view, zoomTo],
  );

  const goTo = useCallback(
    (anchor: Anchor, playIt = false) => {
      const span = Math.max(anchor.t1 - anchor.t0, 0.05);
      const pad = Math.max(0.15, span * 0.6);
      if (anchor.t0 < view.t0 || anchor.t1 > view.t1 || view.t1 - view.t0 > span * 40) zoomTo(anchor.t0 - pad, anchor.t1 + pad);
      setSelectedShape(anchor.shapeId ?? null);
      setSelected(null);
      if (anchor.t1 > anchor.t0) setSelection({ a: anchor.t0, b: anchor.t1 });
      else setSelection(null);
      setCursor(anchor.t0);
      if (playIt && engine && anchor.t1 > anchor.t0) {
        playQueue.current = [];
        engine.play(anchor.t0, anchor.t1);
        setPlaying(true);
      }
    },
    [view, zoomTo, engine],
  );

  const playSequence = (items: TagItem[]) => {
    if (!engine) return;
    const spans = items
      .map((it) => [it.anchor.t0, Math.max(it.anchor.t1, it.anchor.t0 + 0.15)] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    if (!spans.length) return;
    playQueue.current = spans.slice(1);
    engine.play(spans[0][0], spans[0][1]);
    setSelection({ a: spans[0][0], b: spans[0][1] });
    setPlaying(true);
  };

  const playRange = (a: number, b: number) => {
    if (!engine || !playOnClick) return;
    playQueue.current = [];
    engine.play(a, b);
    setPlaying(true);
  };

  // Open the editor where a notification or a guideline reference points.
  const targetDone = useRef(false);
  useEffect(() => {
    if (!engine || !target || targetDone.current) return;
    targetDone.current = true;
    goTo(target.anchor);
    setPanel(target.threadId ? 'threads' : 'tags');
  }, [engine, target, goTo]);

  const tagLane: LaneItem[] = tagEntries.map((e) => {
    const first = defById.get(e.item.tags.find((x) => tagFilter.size === 0 || tagFilter.has(x)) ?? e.item.tags[0]);
    return {
      id: `${e.item.id}`,
      t0: e.item.anchor.t0,
      t1: e.item.anchor.t1,
      f0: e.item.anchor.f0,
      f1: e.item.anchor.f1,
      color: first?.color ?? '#59626E',
      title: `${e.item.tags.map((x) => defById.get(x)?.name ?? x).join(', ')} (${e.author})`,
      highlighted: tagFilter.size > 0 ? e.item.tags.some((x) => tagFilter.has(x)) : panel === 'tags',
    };
  });
  const threadLane: LaneItem[] = threads
    .filter((d) => d.content.status === 'open' || d.row.id === openThread)
    .map((d) => ({
      id: d.row.id,
      t0: d.content.anchor.t0,
      t1: d.content.anchor.t1,
      f0: d.content.anchor.f0,
      f1: d.content.anchor.f1,
      color: d.content.status === 'open' ? '#8E2C3A' : '#59626E',
      title: d.content.messages[0]?.text || t('Flagged for discussion'),
      highlighted: d.row.id === openThread,
    }));
  const focusSpans: [number, number][] | null =
    tagFocus && tagFilter.size > 0
      ? tagEntries.filter((e) => e.item.tags.some((x) => tagFilter.has(x))).map((e) => [e.item.anchor.t0, Math.max(e.item.anchor.t1, e.item.anchor.t0 + 0.02)])
      : null;

  // ------------------------------------------------------------ keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;
      if (e.key === 'Escape') {
        setMenu(null);
        if (typing) (target as HTMLInputElement).blur();
        return;
      }
      if (typing) return;
      if (e.key === ' ') {
        e.preventDefault();
        play();
      } else if (e.key === 'Enter' && rangeTarget) {
        // Cut the selected range out of the active tier as a new interval.
        e.preventDefault();
        splitAtRange(rangeTarget, null);
        wantLabelFocus.current = true;
      } else if (e.key === 'Enter' && selModel?.editable) {
        // Add a boundary or point at the cursor on the selected tier.
        const tier = selModel.doc.content;
        e.preventDefault();
        if (tier.type === 'interval') {
          const i = tier.boundaries.findIndex((b) => b > cursor);
          const at = i === -1 ? tier.boundaries.length : i;
          if (cursor > 0 && cursor < duration && !tier.boundaries.some((b) => Math.abs(b - cursor) < 1e-4)) {
            const boundaries = [...tier.boundaries.slice(0, at), cursor, ...tier.boundaries.slice(at)];
            const labels = [...tier.labels.slice(0, at + 1), '', ...tier.labels.slice(at + 1)];
            updateDoc(selModel.doc.row.id, { ...tier, boundaries, labels });
            setSelected({ docId: selModel.doc.row.id, type: 'interval', index: at + 1 });
          }
        } else {
          const points = [...tier.points, { t: cursor, label: '' }].sort((a, b) => a.t - b.t);
          updateDoc(selModel.doc.row.id, { ...tier, points });
          setSelected({ docId: selModel.doc.row.id, type: 'point', index: points.findIndex((p) => p.t === cursor) });
        }
        wantLabelFocus.current = true;
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected && selModel?.editable) {
        const tier = selModel.doc.content;
        e.preventDefault();
        if (selected.type === 'boundary' && tier.type === 'interval') {
          updateDoc(selModel.doc.row.id, removeBoundary(tier, selected.index));
          setSelected(null);
        } else if (selected.type === 'point' && tier.type === 'point') {
          updateDoc(selModel.doc.row.id, { ...tier, points: tier.points.filter((_, i) => i !== selected.index) });
          setSelected(null);
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedShape && mySketch?.content.shapes.some((s) => s.id === selectedShape)) {
        e.preventDefault();
        updateDoc(mySketch.row.id, { shapes: mySketch.content.shapes.filter((s) => s.id !== selectedShape) });
        setSelectedShape(null);
      } else if (e.key === '+' || e.key === '=') zoomBy(0.5);
      else if (e.key === '-') zoomBy(2);
      else if (e.key === 'n' && selection) zoomTo(selection.a, selection.b);
      else if (e.key === 'a' && !e.metaKey && !e.ctrlKey) zoomTo(0, duration);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const span = view.t1 - view.t0;
        const d = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? span * 0.5 : span * 0.01);
        setCursor((c) => Math.max(0, Math.min(duration, c + d)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [play, selModel, selected, selectedShape, mySketch, cursor, duration, updateDoc, zoomBy, zoomTo, selection, view]);

  // ------------------------------------------------------------ import / export
  const importInput = useRef<HTMLInputElement>(null);
  const importTextGrid = async (file: File) => {
    try {
      const { tiers } = parseTextGrid(await file.text());
      for (const tier of tiers) addTier(tier.name, tier.type, tier);
      setPanel('tiers');
    } catch (e) {
      setSaveError((e as Error).message);
    }
  };

  const baseName = recording.meta.name.replace(/\.[^.]+$/, '');

  const exportTextGrid = (scope: 'mine' | 'visible') => {
    const models = scope === 'mine' ? tierModels.filter((m) => m.editable) : visibleTiers;
    const tiers = models.map((m) => ({ ...m.doc.content, name: m.editable ? m.doc.content.name : `${m.doc.content.name} (${m.author})` }));
    downloadText(writeTextGrid(tiers, duration), `${baseName}.TextGrid`);
  };

  const exportImage = () => {
    const m = canvasRefs.current;
    const spec = m.get('spec');
    if (!spec) return;
    const parts = [m.get('wave'), spec, ...visibleTiers.map((x) => m.get(`tier:${x.doc.row.id}`)), m.get('ruler')].filter(Boolean) as HTMLCanvasElement[];
    const w = spec.width;
    const h = parts.reduce((s, c) => s + c.height, 0);
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    let y = 0;
    for (const c of parts) {
      ctx.drawImage(c, 0, y);
      if (c === spec) {
        const over = m.get('over');
        if (over) ctx.drawImage(over, 0, y);
        // Drawings are SVG; rasterise them on top.
        const svg = document.querySelector<SVGSVGElement>('.sketch-layer');
        if (svg) {
          const clone = svg.cloneNode(true) as SVGSVGElement;
          clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
          const img = new Image();
          const data = new XMLSerializer().serializeToString(clone);
          img.onload = () => {
            ctx.drawImage(img, 0, m.get('wave')?.height ?? 0, w, spec.height);
            out.toBlob((b) => b && downloadBlob(b, `${baseName}.png`));
          };
          img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}`;
          y += c.height;
          continue;
        }
      }
      y += c.height;
    }
    if (!document.querySelector('.sketch-layer')) out.toBlob((b) => b && downloadBlob(b, `${baseName}.png`));
  };

  // ------------------------------------------------------------ render
  const admin = isAdmin(team);

  if (loadError) {
    return (
      <div className="centre-page">
        <div className="sheet">
          <h1>{recording.meta.name}</h1>
          <p className="error">{loadError}</p>
          <button type="button" className="btn" onClick={onClose}>{t('Back to {team}', { team: team.name })}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="editor" onClick={() => menu && setMenu(null)}>
      <header className="editor-bar">
        <button type="button" className="back" onClick={onClose}>
          <span aria-hidden="true">‹</span> {team.name}
        </button>
        <h1 className="editor-title">{recording.meta.name}</h1>
        <span className={`save-state ${saveState}`} role="status">
          {saveState === 'saving' ? t('Encrypting and saving…') : saveState === 'error' ? t('Not saved') : t('All changes saved')}
        </span>
      </header>

      <div className="toolbar" role="toolbar" aria-label={t('Editor tools')}>
        <div className="tool-group">
          <button type="button" className="btn tool primary-tool" onClick={() => play()} disabled={!engine} aria-keyshortcuts="Space">
            <Icon name={playing ? 'stop' : 'play'} />
            {playing ? t('Stop') : selection ? t('Play selection') : t('Play')}
          </button>
        </div>
        <div className="btn-group" role="group" aria-label={t('Zoom')}>
          <button type="button" className="btn tool icon-only" onClick={() => zoomBy(0.5)} title={t('Zoom in (+)')} aria-label={t('Zoom in (+)')}>
            <Icon name="zoomIn" />
          </button>
          <button type="button" className="btn tool icon-only" onClick={() => zoomBy(2)} title={t('Zoom out (−)')} aria-label={t('Zoom out (−)')}>
            <Icon name="zoomOut" />
          </button>
          <button type="button" className="btn tool" onClick={() => selection && zoomTo(selection.a, selection.b)} disabled={!selection} title="N">
            <Icon name="zoomSel" />
            {t('Selection')}
          </button>
          <button type="button" className="btn tool" onClick={() => zoomTo(0, duration)} title="A">
            <Icon name="zoomAll" />
            {t('All')}
          </button>
        </div>
        <div className="btn-group" role="radiogroup" aria-label={t('Drawing tools')}>
          {(
            [
              ['select', t('Select'), 'select'],
              ['ellipse', t('Circle'), 'ellipse'],
              ['rect', t('Box'), 'rect'],
              ['arrow', t('Arrow'), 'arrow'],
              ['freehand', t('Pen'), 'pen'],
              ['text', t('Text'), 'text'],
            ] as [Tool, string, IconName][]
          ).map(([k, label, icon]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={tool === k}
              aria-label={label}
              title={label}
              className="btn tool icon-only"
              onClick={() => setTool(k)}
            >
              <Icon name={icon} />
            </button>
          ))}
        </div>
        <div className="tool-group layers" aria-label={t('Layers')}>
          {(
            [
              ['pitch', t('Pitch')],
              ['formants', t('Formants')],
              ['intensity', t('Intensity')],
              ['rate', t('Speech rate')],
            ] as [keyof Layers, string][]
          ).map(([k, label]) => (
            <label key={k} className={`layer-toggle layer-${k}`}>
              <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <div className="tool-group end">
          <div className="menu-wrap">
            <button
              type="button"
              className="btn tool"
              aria-expanded={menu === 'analysis'}
              onClick={(e) => {
                e.stopPropagation();
                setMenu(menu === 'analysis' ? null : 'analysis');
              }}
            >
              {t('Analysis settings')}
            </button>
            {menu === 'analysis' && (
              <div className="popover" onClick={(e) => e.stopPropagation()}>
                <label className="field">
                  <span>{t('Spectrogram')}</span>
                  <select value={spec.windowLength} onChange={(e) => setSpec({ ...spec, windowLength: Number(e.target.value) })}>
                    <option value={0.005}>{t('Broadband (5 ms window)')}</option>
                    <option value={0.03}>{t('Narrowband (30 ms window)')}</option>
                  </select>
                </label>
                <label className="field">
                  <span>{t('Maximum frequency')}</span>
                  <select value={spec.maxFrequency} onChange={(e) => setSpec({ ...spec, maxFrequency: Number(e.target.value) })}>
                    {[4000, 5000, 5500, 8000].map((f) => (
                      <option key={f} value={f}>{f} Hz</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{t('Dynamic range')}</span>
                  <select value={spec.dynamicRange} onChange={(e) => setSpec({ ...spec, dynamicRange: Number(e.target.value) })}>
                    {[40, 50, 60, 70].map((d) => (
                      <option key={d} value={d}>{d} dB</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{t('Pitch range')}</span>
                  <select
                    value={`${pitchRange.min}-${pitchRange.max}`}
                    onChange={(e) => {
                      const [min, max] = e.target.value.split('-').map(Number);
                      setPitchRange({ min, max });
                    }}
                  >
                    <option value="75-500">75–500 Hz</option>
                    <option value="75-300">{t('75–300 Hz (lower voices)')}</option>
                    <option value="100-600">{t('100–600 Hz (higher voices)')}</option>
                    <option value="150-800">{t('150–800 Hz (children)')}</option>
                  </select>
                </label>
                <label className="field">
                  <span>{t('Spectrogram height')}</span>
                  <select value={specHeight} onChange={(e) => setSpecHeight(Number(e.target.value))}>
                    <option value={220}>{t('Compact')}</option>
                    <option value={300}>{t('Standard')}</option>
                    <option value={420}>{t('Tall')}</option>
                  </select>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={playOnClick}
                    onChange={(e) => {
                      setPlayOnClick(e.target.checked);
                      localStorage.setItem(PLAY_ON_CLICK_KEY, String(e.target.checked));
                    }}
                  />
                  <span>{t('Play an interval when I click it')}</span>
                </label>
                {!analysis && engine && <p className="hint">{t('Analysing…')}</p>}
              </div>
            )}
          </div>
          <div className="menu-wrap">
            <button
              type="button"
              className="btn tool"
              aria-expanded={menu === 'file'}
              onClick={(e) => {
                e.stopPropagation();
                setMenu(menu === 'file' ? null : 'file');
              }}
            >
              {t('Import and export')}
            </button>
            {menu === 'file' && (
              <div className="popover menu" role="menu" onClick={() => setMenu(null)}>
                <button type="button" role="menuitem" onClick={() => importInput.current?.click()}>{t('Import TextGrid as my tiers…')}</button>
                <button type="button" role="menuitem" onClick={() => exportTextGrid('mine')}>{t('Export my tiers as TextGrid')}</button>
                <button type="button" role="menuitem" onClick={() => exportTextGrid('visible')}>{t('Export all shown tiers as TextGrid')}</button>
                <button type="button" role="menuitem" onClick={exportImage}>{t('Save the view as an image (PNG)')}</button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!analysis}
                  onClick={() => analysis && downloadText(measuresCsv(analysis, duration), `${baseName}-measures.csv`, 'text/csv')}
                >
                  {t('Export acoustic measures (CSV, every 10 ms)')}
                </button>
                {visibleTiers
                  .filter((m): m is TierModel & { doc: AnnotationDoc<IntervalTier> } => m.doc.content.type === 'interval')
                  .map((m) => (
                    <button
                      key={m.doc.row.id}
                      type="button"
                      role="menuitem"
                      disabled={!analysis}
                      onClick={() =>
                        analysis &&
                        downloadText(
                          intervalReportCsv(analysis, m.doc.content, duration),
                          `${baseName}-${m.doc.content.name}${m.editable ? '' : `-${m.author}`}.csv`,
                          'text/csv',
                        )
                      }
                    >
                      {m.editable
                        ? t('Export measures per interval of “{tier}” (CSV)', { tier: m.doc.content.name })
                        : t('Export measures per interval of “{tier}” by {name} (CSV)', { tier: m.doc.content.name, name: m.author })}
                    </button>
                  ))}
                {!analysis && <p className="menu-note">{t('The measures are still being computed.')}</p>}
                {visibleTiers.every((m) => m.doc.content.type !== 'interval') && (
                  <p className="menu-note">{t('Add an interval tier to export measures per interval.')}</p>
                )}
              </div>
            )}
          </div>
          <input
            ref={importInput}
            type="file"
            accept=".TextGrid,.textgrid,text/plain"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importTextGrid(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <div className="label-bar" style={{ ['--gutter' as string]: `${GUTTER}px` }}>
        <div className="label-bar-info">
          {selLabel ? (
            <>
              <span className="label-tier">{selModel?.doc.content.name}</span>
              <span className="label-times">
                {formatTime(selLabel.start)}
                {selLabel.end !== undefined && ` – ${formatTime(selLabel.end)} s`}
              </span>
            </>
          ) : rangeTarget ? (
            <>
              <span className="label-tier">{rangeTarget.model.doc.content.name}</span>
              <span className="label-times">
                {formatTime(rangeTarget.a)} – {formatTime(rangeTarget.b)} s
              </span>
            </>
          ) : (
            <span className="label-times">
              {selection
                ? `${formatTime(selection.a)} – ${formatTime(selection.b)} s (${formatTime(selection.b - selection.a)})`
                : `${formatTime(cursor)} s`}
            </span>
          )}
        </div>
        <input
          ref={labelInput}
          className="label-input ipa"
          value={selLabel?.value ?? ''}
          disabled={!selLabel?.editable && !rangeTarget}
          placeholder={
            rangeTarget
              ? t('Type to label only the selected stretch on “{tier}”', { tier: rangeTarget.model.doc.content.name })
              : selLabel
              ? selLabel.editable
                ? t('Type a label')
                : t('Read-only: this tier belongs to {name}', { name: selModel?.author ?? '' })
              : t('Select an interval or a point to label it')
          }
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          aria-label={t('Label')}
          spellCheck={false}
          autoComplete="off"
        />
        <button type="button" className="btn tool" aria-pressed={showKeyboard} onClick={() => setShowKeyboard(!showKeyboard)}>
          {t('IPA keyboard')}
        </button>
      </div>
      {showKeyboard && <IpaKeyboard onInsert={insertText} />}

      <div className="editor-body">
        <div className="editor-main">
          {saveError && (
            <p className="error banner" role="alert">
              {t('Saving failed: {msg}', { msg: saveError })}
            </p>
          )}
          {engine ? (
            <Timeline
              engine={engine}
              analysis={analysis}
              view={view}
              setView={setView}
              cursor={cursor}
              setCursor={setCursor}
              selection={selection}
              setSelection={setSelection}
              tiers={visibleTiers}
              sketches={sketchModels}
              selected={selected}
              setSelected={setSelected}
              selectedShape={selectedShape}
              setSelectedShape={(id) => {
                setSelectedShape(id);
                if (id) setPanel('notes');
              }}
              tool={tool}
              layers={layers}
              spec={spec}
              specHeight={specHeight}
              pitchRange={pitchRange}
              onTierChange={(id, tier) => updateDoc(id, tier)}
              onShapeCommit={commitShape}
              onLabelFocus={() => (wantLabelFocus.current = true)}
              strip={strip}
              playhead={playhead}
              canvasRefs={canvasRefs}
              onShapeDelete={deleteShape}
              onPlayRange={playRange}
              tagLane={tagLane}
              threadLane={threadLane}
              focusSpans={focusSpans}
              onLaneClick={(item) => {
                const th = threads.find((d) => d.row.id === item.id);
                if (th) {
                  setOpenThread(th.row.id);
                  setPanel('threads');
                  goTo(th.content.anchor);
                  return;
                }
                const e = tagEntries.find((x) => x.item.id === item.id);
                if (e) {
                  setPanel('tags');
                  goTo(e.item.anchor, true);
                }
              }}
            />
          ) : (
            <p className="muted pad">{t('Decrypting and decoding the recording…')}</p>
          )}
          {engine && visibleTiers.length === 0 && (
            <p className="hint pad">
              {t('Add a tier in the panel on the right. Double-click a tier to add a boundary or a point; press Enter to add one at the cursor.')}
            </p>
          )}
        </div>

        <aside className="side">
          <div className="side-tabs" role="tablist">
            {(
              [
                ['tiers', t('Tiers')],
                ['measures', t('Measures')],
                ['notes', t('Drawings')],
                ['tags', t('Tags')],
                ['threads', threads.some((d) => d.content.status === 'open') ? t('Discuss ({n})', { n: threads.filter((d) => d.content.status === 'open').length }) : t('Discuss')],
                ['agreement', t('Agreement')],
              ] as [Panel, string][]
            ).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={panel === k} onClick={() => setPanel(k)}>
                {label}
              </button>
            ))}
          </div>
          <div className="side-body">
            {panel === 'tiers' && (
              <TiersPanel
                models={tierModels}
                hidden={hidden}
                setHidden={setHidden}
                locked={team.team.settings.lockVisibility}
                defaultVisibility={defaultVisibility}
                admin={admin}
                blindRevealed={recording.row.blind_revealed}
                onAdd={(name, type) => {
                  const id = addTier(name, type);
                  setSelected({ docId: id, type: type === 'interval' ? 'interval' : 'point', index: 0 });
                }}
                onRename={(id, name) => {
                  const m = tierModels.find((x) => x.doc.row.id === id);
                  if (m) updateDoc(id, { ...m.doc.content, name });
                }}
                onVisibility={(id, visibility, revealAt) => {
                  const m = tierModels.find((x) => x.doc.row.id === id);
                  if (m) updateDoc(id, m.doc.content, { visibility, reveal_at: revealAt });
                }}
                onCopy={(id) => {
                  const m = tierModels.find((x) => x.doc.row.id === id);
                  if (m) addTier(m.doc.content.name, m.doc.content.type, structuredClone(m.doc.content));
                }}
                onDelete={async (id) => {
                  setDocs((cur) => cur.filter((d) => d.row.id !== id));
                  const timer = saveTimers.current.get(id);
                  if (timer) window.clearTimeout(timer);
                  saveTimers.current.delete(id);
                  if (selected?.docId === id) setSelected(null);
                  await backend.deleteAnnotation(id).catch((e) => setSaveError(e.message));
                }}
                onRevealBlind={async (reveal) => {
                  await backend.updateRecording(recording.row.id, { blind_revealed: reveal });
                  setRecording({ ...recording, row: { ...recording.row, blind_revealed: reveal } });
                  await reloadAnnotations();
                }}
                onRefresh={reloadAnnotations}
                onHistory={setHistoryFor}
              />
            )}
            {panel === 'measures' && <MeasuresPanel analysis={analysis} cursor={cursor} selection={selection} duration={duration} />}
            {panel === 'notes' && (
              <NotesPanel
                sketches={docs.filter(isSketch).map((doc) => ({
                  doc,
                  editable: doc.row.author_id === me,
                  color: annotatorColor(doc.row.author_id, order),
                  author: nameOf(doc.row.author_id),
                }))}
                hidden={hidden}
                setHidden={setHidden}
                selectedShape={selectedShape}
                onSelect={(id, shape) => {
                  setSelectedShape(id);
                  const ts = shape.points.map((p) => p[0]);
                  const a = Math.min(...ts);
                  const b = Math.max(...ts);
                  if (a < view.t0 || b > view.t1) zoomTo(a - 0.2, b + 0.2);
                }}
                onChange={(id, sketch) => updateDoc(id, sketch)}
                onVisibility={(id, visibility) => {
                  const d = docs.find((x) => x.row.id === id);
                  if (d) updateDoc(id, d.content, { visibility });
                }}
                locked={team.team.settings.lockVisibility}
              />
            )}
            {panel === 'tags' && (
              <TagsPanel
                defs={tagDefs}
                entries={tagEntries}
                target={currentTarget}
                onToggle={toggleTag}
                onAddDef={onAddTagDef}
                canEditDefs
                filter={tagFilter}
                setFilter={(f) => {
                  setTagFilter(f);
                  if (f.size === 0) setTagFocus(false);
                }}
                focus={tagFocus}
                setFocus={setTagFocus}
                onPlayAll={playSequence}
                onGo={goTo}
                onCite={onCite}
              />
            )}
            {panel === 'threads' && (
              <ThreadsPanel
                threads={threads}
                members={profiles}
                me={me}
                nameOf={nameOf}
                target={currentTarget}
                openId={openThread}
                setOpenId={setOpenThread}
                onCreate={createThread}
                onReply={replyThread}
                onStatus={setThreadStatus}
                onGo={(a) => goTo(a)}
                onCite={onCite}
              />
            )}
            {panel === 'agreement' && (
              <AgreementPanel
                tiers={deferredTiers}
                duration={duration}
                preferredName={selModel?.doc.content.name ?? null}
                config={agreementConfig}
                onConfig={setAgreementConfig}
              />
            )}
          </div>
        </aside>
      </div>
      {historyFor && (() => {
        const m = tierModels.find((x) => x.doc.row.id === historyFor);
        if (!m) return null;
        return (
          <HistoryDialog<Tier>
            team={team}
            annotationId={historyFor}
            title={t('History of “{tier}”', { tier: m.doc.content.name })}
            nameOf={nameOf}
            summarise={(c) =>
              c.type === 'interval'
                ? t('{n} labelled intervals', { n: c.labels.filter((x) => x.trim()).length })
                : t('{n} points', { n: c.points.length })
            }
            preview={(c) => (
              <ol className="history-labels ipa">
                {(c.type === 'interval'
                  ? intervalsOf(c, duration).filter((iv) => iv.label.trim()).map((iv) => [iv.start, iv.label] as const)
                  : c.points.map((pt) => [pt.t, pt.label] as const)
                )
                  .slice(0, 80)
                  .map(([at, label], i) => (
                    <li key={i}>
                      <span className="muted">{formatTime(at, 2)}</span> {label}
                    </li>
                  ))}
              </ol>
            )}
            onRestore={m.editable ? (c) => updateDoc(m.doc.row.id, { ...c, name: m.doc.content.name }) : null}
            onClose={() => setHistoryFor(null)}
          />
        );
      })()}
    </div>
  );
}
