import { MainWorkspace } from "@/components/cad/workspace/MainWorkspace";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default function Page() {
  return (
    <ErrorBoundary>
      <MainWorkspace />
    </ErrorBoundary>
  );
}
