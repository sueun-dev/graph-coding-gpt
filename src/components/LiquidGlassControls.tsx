import type { CSSProperties, MouseEvent, ReactNode } from "react";
import LiquidGlass from "liquid-glass-react";

type GlassTone = "primary" | "secondary" | "ghost" | "status";

type GlassSize = {
  width: number | string;
  height?: number | string;
};

type LiquidGlassButtonProps = GlassSize & {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  tone?: GlassTone;
  title?: string;
  type?: "button" | "submit" | "reset";
};

type LiquidGlassBadgeProps = GlassSize & {
  children: ReactNode;
  tone?: GlassTone;
};

const sizeStyle = ({ width, height = 34 }: GlassSize): CSSProperties => ({
  width: typeof width === "number" ? `${width}px` : width,
  height: typeof height === "number" ? `${height}px` : height,
});

const glassProps = {
  displacementScale: 58,
  blurAmount: 0.08,
  saturation: 135,
  aberrationIntensity: 1.8,
  elasticity: 0.32,
  cornerRadius: 999,
  padding: "0",
  mode: "standard" as const,
  style: { position: "absolute", top: "50%", left: "50%", width: "100%", height: "100%" } satisfies CSSProperties,
};

export function LiquidGlassButton({
  children,
  disabled = false,
  onClick,
  tone = "primary",
  title,
  type = "button",
  width,
  height = 34,
}: LiquidGlassButtonProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!disabled) {
      onClick?.();
    }
  };

  return (
    <span className={`liquid-glass-slot ${disabled ? "is-disabled" : ""}`} style={sizeStyle({ width, height })}>
      <LiquidGlass className="liquid-glass-shell" {...glassProps} onClick={disabled ? undefined : () => undefined}>
        <button
          type={type}
          title={title}
          className={`liquid-glass-button is-${tone}`}
          disabled={disabled}
          onClick={handleClick}
        >
          {children}
        </button>
      </LiquidGlass>
    </span>
  );
}

export function LiquidGlassBadge({ children, tone = "status", width, height = 24 }: LiquidGlassBadgeProps) {
  return (
    <span className="liquid-glass-slot liquid-glass-slot--badge" style={sizeStyle({ width, height })}>
      <LiquidGlass
        className="liquid-glass-shell"
        {...glassProps}
        displacementScale={38}
        blurAmount={0.055}
        aberrationIntensity={1.3}
        elasticity={0.22}
      >
        <span className={`liquid-glass-badge is-${tone}`}>{children}</span>
      </LiquidGlass>
    </span>
  );
}
