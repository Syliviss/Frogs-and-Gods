import { Viewport } from "@/components/Viewport";

export default function GamePage() {
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center">
      <Viewport centerChunkX={0} centerChunkY={0} chunks={{}} />
    </div>
  );
}
