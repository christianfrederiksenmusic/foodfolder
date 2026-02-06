import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    items: [
      { name: "skyr", confidence: 0.9 },
      { name: "løg", confidence: 0.85 },
      { name: "tomater", confidence: 0.8 },
    ],
  });
}
