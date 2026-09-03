import { Logo } from "./Logo.tsx";
import { useT } from "./i18n.ts";

type Props = {
  code: string;
  fingerprint: string;
  rejected: boolean;
  onBack: () => void;
};

/**
 * Intentionally blank screen: while the owner decides, nothing from the room
 * content is leaked. Only the fingerprint is shown so both screens can be
 * compared visually without typing anything.
 */
export function Waiting({ code, fingerprint, rejected, onBack }: Props) {
  const t = useT();

  return (
    <div class="waiting">
      <Logo />

      {rejected ? (
        <>
          <p class="fingerprint">{fingerprint}</p>
          <h2 class="waiting-title">{t.waiting.rejectedTitle}</h2>
          <p class="waiting-hint">
            {t.waiting.rejectedPre}
            <strong>{code}</strong>
            {t.waiting.rejectedPost}
          </p>
        </>
      ) : (
        <>
          <p class="waiting-status">
            <span class="pulse" aria-hidden="true" />
            {t.waiting.waitingPre}
            <strong>{code}</strong>
          </p>
          <p class="fingerprint">{fingerprint}</p>
          <p class="waiting-hint">{t.waiting.hint}</p>
        </>
      )}

      <button type="button" class="btn btn-secondary waiting-back" onClick={onBack}>
        {t.waiting.back}
      </button>
    </div>
  );
}
