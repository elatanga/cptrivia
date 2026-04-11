import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppShell } from './AppShell';

vi.mock('../services/soundService', () => ({
  soundService: {
    getMute: vi.fn(() => false),
    getVolume: vi.fn(() => 0.5),
    setMute: vi.fn(),
    setVolume: vi.fn(),
    playClick: vi.fn(),
  },
}));


describe('AppShell branding and credits', () => {
  it('renders premium logo lockup with bottle, title stack, and flute', () => {
    render(
      <AppShell username="host" activeShowTitle="Studio Show">
        <div>child</div>
      </AppShell>
    );

    expect(screen.getByTestId('brand-lockup')).toBeInTheDocument();
    expect(screen.getByTestId('brand-wordmark-stack')).toBeInTheDocument();
    expect(screen.getByTestId('brand-gold-divider')).toBeInTheDocument();
    expect(screen.getByTestId('brand-subtitle')).toBeInTheDocument();
    expect(screen.getByLabelText(/champagne bottle/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/champagne flute/i)).toBeInTheDocument();
    expect(screen.getByText('CPJS')).toBeInTheDocument();
    expect(screen.getByText(/CruzPham Jeopardy Studios/i)).toBeInTheDocument();
    expect(screen.queryByTestId('brand-title-stack')).not.toBeInTheDocument();
  });

  it('uses tightened lockup spacing and stable centered brand stack classes', () => {
    render(
      <AppShell username="host">
        <div>child</div>
      </AppShell>
    );

    const lockup = screen.getByTestId('brand-lockup');
    const titleStack = screen.getByTestId('brand-wordmark-stack');
    const subtitle = screen.getByTestId('brand-subtitle');

    expect(lockup.className).toContain('gap-0');
    expect(titleStack.className).toContain('flex-col');
    expect(titleStack.className).toContain('text-center');
    expect(titleStack.className).toContain('w-fit');
    expect(subtitle.className).toContain('w-full');
    expect(subtitle.className).toContain('overflow-hidden');
  });

  it('renders footer credits as wrapped premium groups with no overlap-prone row class', () => {
    render(
      <AppShell username="host" shortcuts={<div data-testid="shortcuts">shortcuts</div>}>
        <div>child</div>
      </AppShell>
    );

    const footer = screen.getByTestId('app-footer');
    const footerRow = screen.getByTestId('footer-content-row');
    const credits = screen.getByTestId('footer-credits');

    expect(screen.getByTestId('credit-created-by')).toHaveTextContent('Created by El CruzPham');
    expect(screen.getByTestId('credit-powered-by')).toHaveTextContent('Powered by CruzPham Agency');

    expect(footer.className).toContain('lg:flex-row');
    expect(footer.className).not.toContain('lg:row');
    expect(footerRow.className).toContain('lg:flex-wrap');
    expect(credits.className).toContain('flex-wrap');
    expect(credits.className).toContain('min-w-0');
  });
});

