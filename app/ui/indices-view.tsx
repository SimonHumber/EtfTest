"use client";

import { useEffect, useState } from "react";
import { indexListings } from "../lib/index-directory";
import { BacktestView } from "./backtest-view";

export function IndicesView({ active }: { active: boolean }) {
  const [activated, setActivated] = useState(active);
  useEffect(() => {
    if (active) setActivated(true);
  }, [active]);
  if (!active && !activated) return null;
  return <BacktestView indices={indexListings}/>;
}
