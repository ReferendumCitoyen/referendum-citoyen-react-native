import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
  prepareErrorReport,
  sendErrorReport,
  isExpectedError,
  ReportContext,
  PreparedReport,
} from '@/utils/error-reporter';

interface ErrorReportContextValue {
  pendingReport: PreparedReport | null;
  reportError: (err: unknown, context?: ReportContext) => Promise<void>;
  sendPending: () => Promise<void>;
  clearReport: () => void;
  isExpected: (err: unknown) => boolean;
}

const Ctx = createContext<ErrorReportContextValue | null>(null);

export function ErrorReportProvider({ children }: { children: React.ReactNode }) {
  const [pendingReport, setPendingReport] = useState<PreparedReport | null>(null);
  const inFlight = useRef(false);

  const reportError = useCallback(async (err: unknown, context?: ReportContext) => {
    // Log the error so it ends up in the snapshot itself.
    console.error('[error-report]', err);
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const report = await prepareErrorReport(err, context);
      setPendingReport(report);
    } catch (e) {
      // Reporting must never crash the app.
      console.warn('[error-report] failed to prepare report', e);
    } finally {
      inFlight.current = false;
    }
  }, []);

  const sendPending = useCallback(async () => {
    if (!pendingReport) return;
    try {
      await sendErrorReport(pendingReport.uri);
    } catch (e) {
      console.warn('[error-report] send failed', e);
    }
  }, [pendingReport]);

  const clearReport = useCallback(() => setPendingReport(null), []);

  const value = useMemo<ErrorReportContextValue>(
    () => ({ pendingReport, reportError, sendPending, clearReport, isExpected: isExpectedError }),
    [pendingReport, reportError, sendPending, clearReport],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useErrorReporter(): ErrorReportContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useErrorReporter must be used within ErrorReportProvider');
  return v;
}
