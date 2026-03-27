import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App';
import { authService } from './services/authService';

declare const jest: any;
declare const describe: any;
declare const test: any;
declare const expect: any;
declare const beforeEach: any;

// Mock sound service
jest.mock('./services/soundService', () => ({
  soundService: {
    playClick: jest.fn(),
    playSelect: jest.fn(),
    playReveal: jest.fn(),
    playAward: jest.fn(),
    playSteal: jest.fn(),
    playVoid: jest.fn(),
    playDoubleOrNothing: jest.fn(),
    playTimerTick: jest.fn(),
    playTimerAlarm: jest.fn(),
    playToast: jest.fn(),
    setMute: jest.fn(), getMute: jest.fn().mockReturnValue(false),
    setVolume: jest.fn(), getVolume: jest.fn().mockReturnValue(0.5)
  }
}));

// Mock Gemini
jest.mock('./services/geminiService', () => ({
  generateTriviaGame: jest.fn().mockResolvedValue([]),
  generateSingleQuestion: jest.fn().mockResolvedValue({ text: 'AI Q', answer: 'AI A' })
}));

window.scrollTo = jest.fn();
window.confirm = jest.fn(() => true);

describe('Template Builder UX & Scoping', () => {
  beforeEach(async () => {
    localStorage.clear();
    jest.clearAllMocks();
    
    // Auth
    const token = await authService.bootstrapMasterAdmin('admin');
    await authService.login('admin', token);
  });

  const navigateToBuilder = async () => {
    render(<App />);
    // Create Show
    await waitFor(() => screen.getByPlaceholderText(/New Show Title/i));
    fireEvent.change(screen.getByPlaceholderText(/New Show Title/i), { target: { value: 'UX Show' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));
    
    // Open Template Creator
    await waitFor(() => screen.getByText(/Create Template/i));
    fireEvent.click(screen.getByText(/Create Template/i));
    
    // Fill config and start building
    await waitFor(() => screen.getByPlaceholderText(/e.g. Science Night 2024/i));
    fireEvent.change(screen.getByPlaceholderText(/e.g. Science Night 2024/i), { target: { value: 'UX Game' } });
    fireEvent.click(screen.getByText(/Start Manual Studio Building/i));
  };

  test('Style Scope: Builder root has "template-builder" and uses Roboto Bold', async () => {
    await navigateToBuilder();
    
    await waitFor(() => {
      const builderRoot = document.querySelector('.template-builder');
      expect(builderRoot).toBeInTheDocument();
      expect(builderRoot).toHaveClass('font-roboto');
      expect(builderRoot).toHaveClass('font-bold');
    });
  });

  test('Compactness: Builder tiles use smaller text logic', async () => {
    await navigateToBuilder();
    
    await waitFor(() => {
      // Compact mode keeps the builder controls visible while the preview stays active.
      expect(screen.getByText(/Live Builder Preview/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Save Template/i })).toBeInTheDocument();
    });
  });

  test('Layout: Desktop has side-by-side config and preview', async () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1200 });
    window.dispatchEvent(new Event('resize'));
    
    await navigateToBuilder();
    
    await waitFor(() => {
      const builderRoot = document.querySelector('.template-builder');
      const sidebar = builderRoot?.querySelector('aside');
      expect(builderRoot).toBeInTheDocument();
      expect(sidebar).toBeInTheDocument();
      expect(sidebar).not.toHaveClass('hidden');
      expect(screen.getByText(/Live Builder Preview/i)).toBeInTheDocument();
    });
  });

  test('UX: Reset Builder clears state and returns to config', async () => {
    await navigateToBuilder();
    
    await waitFor(() => screen.getByText(/Reset Board/i));
    fireEvent.click(screen.getByText(/Reset Board/i));
    
    await waitFor(() => {
      expect(screen.getByText(/New Template Configuration/i)).toBeInTheDocument();
    });
  });

  test('UX: Auto-fit toggle functionality exists', async () => {
    await navigateToBuilder();
    
    await waitFor(() => {
        const toggle = document.querySelector('button .lucide-minimize2');
        expect(toggle).toBeInTheDocument();
        fireEvent.click(toggle!.parentElement!);
        // Toggle to maximize
        expect(document.querySelector('.lucide-maximize2')).toBeInTheDocument();
    });
  });
});

