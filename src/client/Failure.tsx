export function Failure({ error, retry }: { error: Error; retry: () => void }) {
  return <div className="failure" role="alert"><p>{error.message}</p><button onClick={retry}>Retry</button></div>;
}

