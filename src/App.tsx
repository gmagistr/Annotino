import { useEffect, useState } from 'react';
import type { ProfileRow, Session } from './backend/types';
import { restore, type Identity } from './app/auth';
import { AuthScreen } from './components/AuthScreen';
import { KeySetup } from './components/KeySetup';
import { UnlockScreen } from './components/UnlockScreen';
import { Workspace } from './components/Workspace';
import { useLang } from './i18n';

type Phase =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'needs-keys'; session: Session; password: string | null }
  | { kind: 'locked'; session: Session; profile: ProfileRow }
  | { kind: 'ready'; identity: Identity };

export function App() {
  useLang();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  useEffect(() => {
    restore()
      .then((r) => {
        if (!r) setPhase({ kind: 'signed-out' });
        else if ('privateKey' in r) setPhase({ kind: 'ready', identity: r });
        else if (r.profile) setPhase({ kind: 'locked', session: r.session, profile: r.profile });
        else setPhase({ kind: 'needs-keys', session: r.session, password: null });
      })
      .catch(() => setPhase({ kind: 'signed-out' }));
  }, []);

  switch (phase.kind) {
    case 'loading':
      return <div className="boot" aria-busy="true" />;
    case 'signed-out':
      return (
        <AuthScreen
          onReady={(identity) => setPhase({ kind: 'ready', identity })}
          onNeedsKeys={(session, password) => setPhase({ kind: 'needs-keys', session, password })}
        />
      );
    case 'needs-keys':
      return (
        <KeySetup
          session={phase.session}
          password={phase.password}
          onDone={(identity) => setPhase({ kind: 'ready', identity })}
          onCancel={() => setPhase({ kind: 'signed-out' })}
        />
      );
    case 'locked':
      return (
        <UnlockScreen
          session={phase.session}
          profile={phase.profile}
          onReady={(identity) => setPhase({ kind: 'ready', identity })}
          onSignOut={() => setPhase({ kind: 'signed-out' })}
        />
      );
    case 'ready':
      return (
        <Workspace
          identity={phase.identity}
          onIdentityChange={(identity) => setPhase({ kind: 'ready', identity })}
          onSignOut={() => setPhase({ kind: 'signed-out' })}
        />
      );
  }
}
