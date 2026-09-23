import { Suspense } from "react";
import { DemoRoot } from "./DemoRoot";

export default function Home() {
  return (
    <Suspense>
      <DemoRoot />
    </Suspense>
  );
}
