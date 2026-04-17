import type { ReactNode } from 'react';

interface Props {
  turnsLeft: number;
  children: ReactNode;
}

export default function TerminalFrame({ turnsLeft, children }: Props) {
  return (
    <div className="terminal-frame">
      <div className="status-bar">
        <div className="signal">
          <div className="signal-bars">
            <div className="signal-bar" />
            <div className="signal-bar" />
            <div className="signal-bar" />
            <div className="signal-bar" />
          </div>
          <span>ERID-LINK</span>
        </div>
        <span className="delay">延迟 4.2ly ⚡</span>
        <span className="turns">通话余量 {turnsLeft}/10</span>
      </div>
      {children}
    </div>
  );
}
