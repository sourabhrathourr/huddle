// The huddle wordmark: the name in mono with a block cursor, like a command line waiting for you.
export function HuddleWordmark() {
  return (
    <span className="wordmark">
      huddle
      <i className="wordmark-cursor" aria-hidden="true" />
    </span>
  );
}
