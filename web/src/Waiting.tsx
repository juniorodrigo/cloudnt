import { Logo } from "./Logo.tsx";

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
  return (
    <div class="waiting">
      <Logo />

      {rejected ? (
        <>
          <p class="fingerprint">{fingerprint}</p>
          <h2 class="waiting-title">Acceso rechazado</h2>
          <p class="waiting-hint">
            El dueño de la sala <strong>{code}</strong> no aprobó este dispositivo. Si fue un
            error, puede deshacerlo durante 30 segundos y entrarías solo.
          </p>
        </>
      ) : (
        <>
          <p class="waiting-status">
            <span class="pulse" aria-hidden="true" />
            Esperando aprobación para la sala <strong>{code}</strong>
          </p>
          <p class="fingerprint">{fingerprint}</p>
          <p class="waiting-hint">
            Comprueba que estas dos palabras son las mismas que aparecen en la pantalla donde
            creaste la sala, y aprueba desde allí.
          </p>
        </>
      )}

      <button type="button" class="btn btn-secondary waiting-back" onClick={onBack}>
        Volver
      </button>
    </div>
  );
}
