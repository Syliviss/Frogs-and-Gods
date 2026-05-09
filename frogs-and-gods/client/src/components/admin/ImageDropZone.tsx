import { useState, useRef } from "react";

function rgbaToHexArray(data: ImageData): (string | null)[] {
  const result: (string | null)[] = [];
  for (let i = 0; i < 256; i++) {
    const b = i * 4;
    if (data.data[b + 3] === 0) {
      result.push(null);
    } else {
      const r = data.data[b].toString(16).padStart(2, "0");
      const g = data.data[b + 1].toString(16).padStart(2, "0");
      const bl = data.data[b + 2].toString(16).padStart(2, "0");
      result.push(`#${r}${g}${bl}`);
    }
  }
  return result;
}

interface ImageDropZoneProps {
  onConverted: (pixels: (string | null)[]) => void;
}

export function ImageDropZone({ onConverted }: ImageDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const prevUrlRef = useRef<string | null>(null);

  function processFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("File must be an image.");
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (img.width !== 16 || img.height !== 16) {
        setError(`Must be exactly 16×16 px (got ${img.width}×${img.height}).`);
        URL.revokeObjectURL(url);
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, 16, 16);
      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
      prevUrlRef.current = url;
      setPreviewSrc(url);
      setError(null);
      onConverted(rgbaToHexArray(imageData));
    };
    img.onerror = () => {
      setError("Could not load image.");
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  return (
    <div style={{ marginBottom: 6 }}>
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        style={{
          border: `1px dashed ${isDragging ? "#60a5fa" : error ? "#f87171" : "#1e2a3a"}`,
          borderRadius: 4,
          padding: "8px 12px",
          background: isDragging ? "#0d1f3c" : "#060d18",
          display: "flex",
          alignItems: "center",
          gap: 10,
          minHeight: 44,
          cursor: "default",
        }}
      >
        {previewSrc && (
          <img
            src={previewSrc}
            alt="sprite preview"
            style={{ width: 32, height: 32, imageRendering: "pixelated", border: "1px solid #1e2a3a", flexShrink: 0 }}
          />
        )}
        <span style={{ fontSize: 10, color: isDragging ? "#93c5fd" : previewSrc ? "#4ade80" : "#4b5563" }}>
          {previewSrc ? "16×16 loaded — drop to replace" : "Drop 16×16 PNG here"}
        </span>
      </div>
      {error && (
        <p style={{ fontSize: 10, color: "#f87171", margin: "3px 0 0 0" }}>{error}</p>
      )}
    </div>
  );
}
