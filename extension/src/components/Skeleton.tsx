/**
 * Loading skeletons.
 *
 * Shaped like the code block they replace, so the popup does not jump when the
 * snippet arrives — a spinner would reserve no space and the whole screen would
 * shift under the user's cursor just as they went to click a line.
 */
export function CodeSkeleton() {
  // Ragged widths: uniform bars read as a progress bar, not as code.
  const widths = [58, 84, 72, 91, 46, 67, 79, 38, 88, 61, 74, 52]

  return (
    <>
      <div className="game__bar">
        <div className="chips">
          <span className="skeleton skeleton--chip" />
          <span className="skeleton skeleton--chip" />
        </div>
        <span className="skeleton skeleton--timer" />
      </div>

      <div className="code-viewer" aria-busy="true" aria-label="Loading a snippet">
        <div className="code-lines">
          {widths.map((width, i) => (
            <div key={i} className="code-line code-line--skeleton">
              <span className="code-line__number" aria-hidden="true">
                {i + 1}
              </span>
              <span className="skeleton skeleton--line" style={{ width: `${width}%` }} />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

export function BoardSkeleton() {
  return (
    <div className="board__list" aria-busy="true" aria-label="Loading the leaderboard">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="board__row">
          <span className="skeleton skeleton--rank" />
          <span className="skeleton skeleton--avatar" />
          <span className="skeleton skeleton--name" />
        </div>
      ))}
    </div>
  )
}
