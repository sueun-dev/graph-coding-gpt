import { type ChangeEvent, useEffect, useRef } from "react";

type FolderOpenButtonProps = {
  label: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  variant?: "primary" | "ghost";
};

export default function FolderOpenButton({
  label,
  onChange,
  variant = "primary",
}: FolderOpenButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }

    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
  }, []);

  const openPicker = () => {
    const input = inputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!input) {
      return;
    }

    input.value = "";

    try {
      if (typeof input.showPicker === "function") {
        input.showPicker();
        return;
      }
    } catch {
      // Fall through to click() for browsers that block showPicker on this input type.
    }

    input.click();
  };

  return (
    <>
      <button type="button" className={`folder-open-button ${variant === "ghost" ? "is-ghost" : "is-primary"}`} onClick={openPicker}>
        <span>{label}</span>
      </button>
      <input
        ref={inputRef}
        className="folder-open-input"
        type="file"
        multiple
        onChange={onChange}
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
      />
    </>
  );
}
