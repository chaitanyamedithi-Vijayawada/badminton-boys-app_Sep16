export default function ContentSkeleton() {
  return (
    <div className="px-4 pt-4 animate-pulse">
      <div className="skeleton-card mb-3">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="skeleton-line w-24 h-4 mb-2" />
            <div className="skeleton-line w-16 h-3" />
          </div>
          <div className="skeleton-line w-16 h-6 rounded-full" />
        </div>
        <div className="flex gap-1.5 mb-3">
          <div className="skeleton-line w-16 h-6 rounded-full" />
          <div className="skeleton-line w-16 h-6 rounded-full" />
          <div className="skeleton-line w-16 h-6 rounded-full" />
        </div>
        <div className="skeleton-line w-full h-2 rounded-full mb-3" />
        <div className="flex gap-2 mb-3">
          <div className="skeleton-line flex-1 h-10 rounded-xl" />
          <div className="skeleton-line flex-1 h-10 rounded-xl" />
        </div>
      </div>

      <div className="skeleton-card mb-3">
        <div className="skeleton-line w-32 h-4 mb-3" />
        <div className="flex flex-col gap-2">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="flex items-center gap-2">
              <div className="skeleton-line w-7 h-7 rounded-full flex-shrink-0" />
              <div className="skeleton-line flex-1 h-3" />
            </div>
          ))}
        </div>
      </div>

      <div className="skeleton-card">
        <div className="skeleton-line w-20 h-4 mb-3" />
        <div className="space-y-2">
          <div className="skeleton-line w-full h-3" />
          <div className="skeleton-line w-3/4 h-3" />
          <div className="skeleton-line w-1/2 h-3" />
        </div>
      </div>
    </div>
  );
}