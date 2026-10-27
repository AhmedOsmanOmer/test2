import type { Metadata } from "next";
import { Board } from "./board";

export const metadata: Metadata = { title: "شاشة الإنتاج المباشر | Production Live Board" };
export const dynamic = "force-dynamic";

export default function LiveBoardPage({ searchParams }: { searchParams: { device?: string } }) {
  return <Board device={searchParams.device ?? null} />;
}
