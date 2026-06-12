import { InputHTMLAttributes, ReactNode, forwardRef } from "react";
import { cn } from "@/lib/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, ...props }, ref) => {
    return (
      <div className="space-y-1">
        {label && (
          <label className="block text-sm font-medium text-dark">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={cn(
            "w-full px-3 py-2.5 rounded-lg border border-gray-300 bg-white text-dark text-sm",
            "placeholder:text-muted",
            "hover:border-gray-400 transition-colors duration-150",
            "focus:outline-none focus:border-[#1D9E75] focus:ring-[3px] focus:ring-[rgba(29,158,117,0.12)]",
            error && "border-red-400 hover:border-red-400 focus:border-red-400 focus:ring-[3px] focus:ring-[rgba(239,68,68,0.12)]",
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    );
  }
);
Input.displayName = "Input";
