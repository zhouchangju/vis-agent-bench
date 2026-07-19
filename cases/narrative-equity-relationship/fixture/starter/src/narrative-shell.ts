/**
 * Intentionally generic host shell. Participants replace this placeholder with
 * their own visual component; no data transformation, graph placement, or
 * narration behaviour is supplied here.
 */
export function createNarrativeGraph(host) {
  host.replaceChildren();
  const message = document.createElement('p');
  message.className = 'starter-message';
  message.textContent = 'Starter ready. Implement the visualization component here.';
  host.append(message);

  return {
    load() {
      // Deliberately empty: data rendering belongs to the task participant.
    },
    destroy() {
      host.replaceChildren();
    },
  };
}
