"use client";

import * as React from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export type CredenzaProps = {
  children?: React.ReactNode;
  className?: string;
  asChild?: boolean;
  render?: React.ReactElement;
} & React.HTMLAttributes<HTMLElement>;

export type RootCredenzaProps = {
  children?: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  modal?: boolean;
};

type CredenzaContextProps = {
  isDesktop: boolean;
};

const CredenzaContext = React.createContext<CredenzaContextProps>({
  isDesktop: true,
});

const useCredenza = () => React.useContext(CredenzaContext);

const Credenza = ({ children, ...props }: RootCredenzaProps) => {
  const isMobile = useIsMobile();
  const isDesktop = !isMobile;
  const contextValue = React.useMemo(() => ({ isDesktop }), [isDesktop]);

  return (
    <CredenzaContext.Provider value={contextValue}>
      {isDesktop ? (
        <Dialog {...props}>{children}</Dialog>
      ) : (
        <Drawer {...props}>{children}</Drawer>
      )}
    </CredenzaContext.Provider>
  );
};

const CredenzaTrigger = ({ className, children, ...props }: CredenzaProps) => {
  const { isDesktop } = useCredenza();

  return isDesktop ? (
    <DialogTrigger
      className={className}
      {...(props as React.ComponentProps<typeof DialogTrigger>)}
    >
      {children}
    </DialogTrigger>
  ) : (
    <DrawerTrigger
      className={className}
      {...(props as React.ComponentProps<typeof DrawerTrigger>)}
    >
      {children}
    </DrawerTrigger>
  );
};

const CredenzaClose = ({ className, children, ...props }: CredenzaProps) => {
  const { isDesktop } = useCredenza();

  return isDesktop ? (
    <DialogClose
      className={className}
      {...(props as React.ComponentProps<typeof DialogClose>)}
    >
      {children}
    </DialogClose>
  ) : (
    <DrawerClose
      className={className}
      {...(props as React.ComponentProps<typeof DrawerClose>)}
    >
      {children}
    </DrawerClose>
  );
};

const CredenzaContent = ({ className, children, ...props }: CredenzaProps) => {
  const { isDesktop } = useCredenza();

  return isDesktop ? (
    <DialogContent
      className={className}
      {...(props as React.ComponentProps<typeof DialogContent>)}
    >
      {children}
    </DialogContent>
  ) : (
    <DrawerContent
      className={className}
      {...(props as React.ComponentProps<typeof DrawerContent>)}
    >
      {children}
    </DrawerContent>
  );
};

const CredenzaDescription = ({
  className,
  children,
  ...props
}: CredenzaProps) => {
  const { isDesktop } = useCredenza();

  return isDesktop ? (
    <DialogDescription
      className={className}
      {...(props as React.ComponentProps<typeof DialogDescription>)}
    >
      {children}
    </DialogDescription>
  ) : (
    <DrawerDescription
      className={className}
      {...(props as React.ComponentProps<typeof DrawerDescription>)}
    >
      {children}
    </DrawerDescription>
  );
};

const CredenzaHeader = ({ className, children, ...props }: CredenzaProps) => {
  const { isDesktop } = useCredenza();

  return isDesktop ? (
    <DialogHeader className={className} {...props}>
      {children}
    </DialogHeader>
  ) : (
    <DrawerHeader className={className} {...props}>
      {children}
    </DrawerHeader>
  );
};

const CredenzaTitle = ({ className, children, ...props }: CredenzaProps) => {
  const { isDesktop } = useCredenza();

  return isDesktop ? (
    <DialogTitle
      className={className}
      {...(props as React.ComponentProps<typeof DialogTitle>)}
    >
      {children}
    </DialogTitle>
  ) : (
    <DrawerTitle
      className={className}
      {...(props as React.ComponentProps<typeof DrawerTitle>)}
    >
      {children}
    </DrawerTitle>
  );
};

const CredenzaBody = ({ className, children, ...props }: CredenzaProps) => {
  return (
    <div
      className={cn(
        "max-h-[70dvh] overflow-y-auto px-4 py-2 md:px-0",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
};

const CredenzaFooter = ({ className, children, ...props }: CredenzaProps) => {
  const { isDesktop } = useCredenza();

  return isDesktop ? (
    <DialogFooter className={className} {...props}>
      {children}
    </DialogFooter>
  ) : (
    <DrawerFooter className={className} {...props}>
      {children}
    </DrawerFooter>
  );
};

export {
  Credenza,
  useCredenza,
  CredenzaTrigger,
  CredenzaClose,
  CredenzaContent,
  CredenzaDescription,
  CredenzaHeader,
  CredenzaTitle,
  CredenzaBody,
  CredenzaFooter,
};
