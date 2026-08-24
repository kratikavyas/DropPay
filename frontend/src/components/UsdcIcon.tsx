import React from "react";

export function UsdcIcon({
  className = "w-4 h-4",
  size,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`inline-block shrink-0 ${className}`}
      aria-label="USDC"
    >
      <circle cx="12" cy="12" r="12" fill="#2775CA" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12.001 3.5C7.306 3.5 3.5 7.306 3.5 12.001C3.5 16.696 7.306 20.502 12.001 20.502C16.696 20.502 20.502 16.696 20.502 12.001C20.502 7.306 16.696 3.5 12.001 3.5ZM12.875 6.5V7.472C14.73 7.697 15.845 8.783 15.867 10.373H14.364C14.336 9.479 13.676 8.784 12.875 8.65V10.96L12.5 11.04C10.74 11.455 10.15 11.967 10.15 13.064C10.15 14.362 11.135 15.195 12.875 15.343V16.5H12.001V15.343C10.026 15.118 8.955 13.992 8.922 12.356H10.425C10.458 13.25 11.196 14.041 12.001 14.165V11.838L12.375 11.758C14.075 11.378 14.72 10.835 14.72 9.774C14.72 8.528 13.791 7.697 12.001 7.558V6.5H12.875ZM11.135 9.774C11.135 9.255 11.464 8.794 12.001 8.66V10.871C11.442 10.601 11.135 10.22 11.135 9.774ZM13.735 13.064C13.735 13.623 13.367 14.085 12.875 14.22V11.938C13.434 12.227 13.735 12.607 13.735 13.064Z"
        fill="white"
      />
    </svg>
  );
}

export function UsdcBadge({
  amount,
  className = "",
  size = "md",
}: {
  amount?: string | number;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const iconSizes = {
    sm: "w-3.5 h-3.5",
    md: "w-4 h-4",
    lg: "w-5 h-5",
  };

  const textSizes = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
  };

  return (
    <span className={`inline-flex items-center gap-1.5 font-medium ${className}`}>
      <UsdcIcon className={iconSizes[size]} />
      {amount !== undefined && <span className={textSizes[size]}>{amount}</span>}
      <span className={`${textSizes[size]} text-white/70 font-sans`}>USDC</span>
    </span>
  );
}
