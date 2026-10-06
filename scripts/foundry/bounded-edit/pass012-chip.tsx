export function ReviewChip(selected: { engineeringReview?: 'PASS' | 'FAIL' | 'PENDING'; engineeringReviewDetail?: string | null }) {
  return (
    <div data-testid="foundry-engineering-review">
      <p className="text-sm">{selected.engineeringReview === 'PASS' ? 'PASS' : selected.engineeringReview === 'FAIL' ? 'FAIL' : 'PENDING'}</p>
    </div>
  )
}
