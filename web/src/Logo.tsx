function Mark({ class: className }: { class?: string }) {
  return (
    <svg
      class={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.1"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M6 17.6h10.6a3.9 3.9 0 0 0 .35-7.78 5.6 5.6 0 0 0-10.75-1.3A3.65 3.65 0 0 0 6 17.6Z" />
    </svg>
  );
}

/** `mark` drops the word: in the room bar the code is the label, not the name. */
export function Logo({ mark = false }: { mark?: boolean } = {}) {
  if (mark) return <Mark class="wordmark-mark solo" />;
  return (
    <span class="wordmark">
      <Mark class="wordmark-mark" />
      {/* The contraction is the point: a cloud it couldn't be. */}
      <span>
        cloudn<span class="wordmark-tail">’t</span>
      </span>
    </span>
  );
}
