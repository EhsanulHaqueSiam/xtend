import { useAtomValue } from "@effect/atom-react";
import { createFileRoute } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { AnalyzePage } from "../components/analyze/AnalyzePage";
import { Ask } from "../components/analyze/Ask";
import { Audience } from "../components/analyze/Audience";
import { BestTime } from "../components/analyze/BestTime";
import { Competitors } from "../components/analyze/Competitors";
import { Overview } from "../components/analyze/Overview";
import { Posts } from "../components/analyze/PostsTable";
import { errorText } from "../components/analyze/ui";
import { useSection } from "../components/shell/sections";
import { Empty } from "../components/ui/layout";
import { NoHandle } from "../components/ui/no-handle";
import { analyzeDataAtom } from "../state/analyze";

/** Each section is its own page over the same loaded data; the sidebar switches between them. */
function AnalyzeScreen() {
  const section = useSection("/analyze");
  const data = useAtomValue(analyzeDataAtom);
  return AsyncResult.match(data, {
    onInitial: () => (
      <AnalyzePage data={null}>
        <Empty>Connecting to the service.</Empty>
      </AnalyzePage>
    ),
    onFailure: (f) => (
      <AnalyzePage data={null}>
        <Empty>
          <span className="text-error-foreground">{errorText(f.cause)}</span>
        </Empty>
      </AnalyzePage>
    ),
    onSuccess: ({ value }) => {
      if (value.handle === null)
        return (
          <AnalyzePage data={value}>
            <NoHandle subject="Analyze needs" />
          </AnalyzePage>
        );
      switch (section) {
        case "overview":
          return <Overview data={value} />;
        case "posts":
          return <Posts data={value} />;
        case "audience":
          return <Audience data={value} />;
        case "best-time":
          return <BestTime data={value} />;
        case "competitors":
          return <Competitors data={value} />;
        case "ask":
          return <Ask data={value} />;
      }
    },
  });
}

export const Route = createFileRoute("/analyze")({ component: AnalyzeScreen });
