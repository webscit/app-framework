import * as React from "react";
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";

import { cn } from "@/lib/utils";

const Sheet = DrawerPrimitive.Root;

const SheetTrigger = DrawerPrimitive.Trigger;

const SheetClose = DrawerPrimitive.Close;

const SheetPortal = DrawerPrimitive.Portal;

function SheetBackdrop({ className, ...props }: DrawerPrimitive.Backdrop.Props) {
  return (
    <DrawerPrimitive.Backdrop
      data-slot="sheet-backdrop"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 transition-all duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

type SheetSide = "top" | "right" | "bottom" | "left";

interface SheetContentProps extends DrawerPrimitive.Popup.Props {
  side?: SheetSide;
}

function SheetContent({
  side = "right",
  className,
  children,
  ...props
}: SheetContentProps) {
  const sideClasses: Record<SheetSide, string> = {
    top: "inset-x-0 top-0 border-b data-open:slide-in-from-top data-closed:slide-out-to-top",
    bottom:
      "inset-x-0 bottom-0 border-t data-open:slide-in-from-bottom data-closed:slide-out-to-bottom",
    left: "inset-y-0 left-0 h-full w-3/4 border-r data-open:slide-in-from-left data-closed:slide-out-to-left sm:max-w-sm",
    right:
      "inset-y-0 right-0 h-full w-3/4 border-l data-open:slide-in-from-right data-closed:slide-out-to-right sm:max-w-sm",
  };

  return (
    <SheetPortal>
      <SheetBackdrop />
      <DrawerPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-background p-6 shadow-lg transition ease-in-out duration-300 data-open:animate-in data-closed:animate-out data-closed:duration-300",
          sideClasses[side],
          className,
        )}
        {...props}
      >
        {children}
      </DrawerPrimitive.Popup>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-0", className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2", className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
  return (
    <DrawerPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-lg font-semibold leading-none text-foreground", className)}
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: DrawerPrimitive.Description.Props) {
  return (
    <DrawerPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetBackdrop,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
