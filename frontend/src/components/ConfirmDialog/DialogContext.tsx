import React, { createContext, useContext, useState, useCallback } from 'react';
import { ConfirmDialog } from './ConfirmDialog';

interface DialogOptions {
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  isAlert?: boolean;
}

interface DialogContextType {
  confirm: (title: string, message: string, options?: DialogOptions) => Promise<boolean>;
  alert: (title: string, message: string) => Promise<void>;
}

const DialogContext = createContext<DialogContextType | undefined>(undefined);

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [options, setOptions] = useState<DialogOptions>({});
  const [resolver, setResolver] = useState<((value: boolean) => void) | null>(null);

  const confirm = useCallback((title: string, message: string, opts?: DialogOptions) => {
    setTitle(title);
    setMessage(message);
    setOptions(opts || {});
    setIsOpen(true);
    return new Promise<boolean>((resolve) => {
      setResolver(() => resolve);
    });
  }, []);

  const alert = useCallback((title: string, message: string) => {
    setTitle(title);
    setMessage(message);
    setOptions({ isAlert: true, confirmLabel: 'OK' });
    setIsOpen(true);
    return new Promise<void>((resolve) => {
      setResolver(() => () => resolve());
    });
  }, []);

  const handleConfirm = () => {
    setIsOpen(false);
    if (resolver) resolver(true);
  };

  const handleCancel = () => {
    setIsOpen(false);
    if (resolver) resolver(false);
  };

  return (
    <DialogContext.Provider value={{ confirm, alert }}>
      {children}
      <ConfirmDialog
        isOpen={isOpen}
        title={title}
        message={message}
        confirmLabel={options.confirmLabel}
        cancelLabel={options.isAlert ? undefined : options.cancelLabel}
        danger={options.danger}
        isAlert={options.isAlert}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error('useDialog must be used within a DialogProvider');
  }
  return context;
}
