import { Bot } from "lucide-react";
import Image from "next/image";

export default function HarnessImage({ src, size }: { src?: string; size: number }) {
  return src ? (
    <Image src={src} alt="" width={size} height={size} className="size-full object-contain" />
  ) : (
    <Bot className="size-1/2 text-muted-foreground" />
  );
}
