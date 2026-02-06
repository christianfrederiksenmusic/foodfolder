import { NextResponse } from "next/server";

type Body = { image?: string | null };

export async function POST(req: Request) {
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body. Expected { image: <base64 data url> }" },
      { status: 400 }
    );
  }

  if (!body.image || typeof body.image !== "string" || !body.image.startsWith("data:image/")) {
    return NextResponse.json(
      { error: "Missing image. Upload an image and try again." },
      { status: 400 }
    );
  }

  // v1 stub: later we will send body.image to Claude Vision and parse ingredients
  return NextResponse.json({
    items: [
      { name: "skyr", confidence: 0.9 },
      { name: "løg", confidence: 0.85 },
      { name: "tomater", confidence: 0.8 },
    ],
    meta: {
      receivedImageBytesApprox: Math.round(body.image.length * 0.75),
    },
  });
}
