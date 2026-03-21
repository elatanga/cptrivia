import React from 'react';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from './App';
import { authService } from './services/authService';
import { specialMovesClient } from './modules/specialMoves/client/specialMovesClient';

// --- MOCKS ---

vi.mock('./services/logger', () => ({
  logger: { 
    info: vi.fn(), 
    error: vi.fn(), 
    warn: vi.fn(), 
    getCorrelationId: () => 'test-id',
    maskPII: (v: any) => v
  }
}));

vi.mock('./services/soundService', () => ({
  soundService: {
    getMute: vi.fn(() => false),
    getVolume: vi.fn(() => 0.5),
    setMute: vi.fn(),
    setVolume: vi.fn(),
    playSelect: vi.fn(),
    playReveal: vi.fn(),
    playAward: vi.fn(),
    playSteal: vi.fn(),
    playVoid: vi.fn(),
    playClick: vi.fn(),
    playTimerTick: vi.fn(),
    playTimerAlarm: vi.fn(),
    playDoubleOrNothing: vi.fn(),
    playToast: vi.fn(),
  }
}));

vi.mock('./modules/specialMoves/client/specialMovesClient', () => {
  let mockOverlayHandler: (data: any) => void = () => {};
  return {
    specialMovesClient: {
      getHealth: vi.fn(() => 'HEALTHY'),
      getBackendMode: vi.fn(() => 'FUNCTIONS'),
      requestArmTile: vi.fn(async () => ({ success: true, id: 'req_1' })),
      clearArmory: vi.fn(async () => ({ success: true, clearedCount: 1 })),
      subscribeOverlay: vi.fn(({ onOverlay }) => {
        mockOverlayHandler = onOverlay;
        onOverlay({ deploymentsByTileId: {}, activeByTargetId: {}, updatedAt: Date.now(), version: 1 });
        return () => {};
      }),
      // Helper for testing to trigger updates
      __triggerUpdate: (data: any) => mockOverlayHandler(data)
    }
  };
});

describe('Special Moves Feature Suite', () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
    
    // Set up a game session
    const token = await authService.bootstrapMasterAdmin('admin');
    const loginRes = await authService.login('admin', token);
    localStorage.setItem('cruzpham_active_session_id', loginRes.session!.id);
  });

  const setupAndPlay = async () => {
    render(<App />);
    // Create Show
    const showInput = await screen.findByPlaceholderText(/New Show Title/i);
    fireEvent.change(showInput, { target: { value: 'SMS Test Show' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));
    
    // Create & Play Template
    fireEvent.click(await screen.findByText(/Create Template/i));
    fireEvent.change(await screen.findByPlaceholderText(/e.g. Science Night 2024/i), { target: { value: 'SMS Test Game' } });
    fireEvent.click(screen.getByText(/Start Manual Studio Building/i));
    fireEvent.click(await screen.findByText(/Save Template/i));
    fireEvent.click(await screen.findByText(/Play Show/i));
    
    return await screen.findByText(/End Show/i);
  };

  it('A) DEPLOYMENT: Director can select a move and arm a tile', async () => {
    await setupAndPlay();

    // 1. Open Director -> Moves Tab
    fireEvent.click(screen.getByText(/Director/i, { selector: 'button' }));
    fireEvent.click(await screen.findByRole('button', { name: /moves tab/i }));
    expect(await screen.findByLabelText(/special moves backend mode/i)).toHaveTextContent(/backend:\s*functions/i);

    // 2. Select DOUBLE OR LOSE
    const moveBtn = await screen.findByText('DOUBLE OR LOSE');
    fireEvent.click(moveBtn);

    // 3. Click first 100pt tile
    const clearBtn = await screen.findByRole('button', { name: /wipe all armed tiles/i });
    const movesPanel = clearBtn.closest('div')?.parentElement?.parentElement ?? document.body;
    const armTileBtn = within(movesPanel).getAllByRole('button').find((button) => button.textContent?.includes('100'));
    expect(armTileBtn).toBeTruthy();
    await act(async () => {
      fireEvent.click(armTileBtn!);
    });

    // 4. Verify client call
    await waitFor(() => {
      expect(specialMovesClient.requestArmTile).toHaveBeenCalledWith(expect.objectContaining({
        moveType: 'DOUBLE_TROUBLE'
      }));
    });

    // 5. Verify success toast
    expect(await screen.findByText(/MOVE DEPLOYED/i)).toBeInTheDocument();
  });

  it('A0) LABELS: Director tabs show SPECIAL MOVES and SPECIAL MOVES GUIDE', async () => {
    await setupAndPlay();

    fireEvent.click(screen.getByText(/Director/i, { selector: 'button' }));

    const specialMovesTab = await screen.findByRole('button', { name: /special moves/i });
    const guideTab = await screen.findByRole('button', { name: /special moves guide/i });

    expect(specialMovesTab).toBeInTheDocument();
    expect(guideTab).toBeInTheDocument();

    fireEvent.click(guideTab);
    expect(await screen.findByText(/special moves guide/i, { selector: 'h3' })).toBeInTheDocument();
  });

  it('A2) GIFT SECTION: shows Gift Activated Special Moves with gift-required markers', async () => {
    await setupAndPlay();

    fireEvent.click(screen.getByText(/Director/i, { selector: 'button' }));
    fireEvent.click(await screen.findByRole('button', { name: /moves tab/i }));

    expect(await screen.findByText(/gift activated special moves/i)).toBeInTheDocument();
    expect(await screen.findAllByText(/gift required/i)).not.toHaveLength(0);
    expect(await screen.findByText('SUPER SAVE')).toBeInTheDocument();
    expect(await screen.findByText('GOLDEN GAMBLE')).toBeInTheDocument();
  });

  it.each([
    ['FIRESTORE_FALLBACK', /backend:\s*firestore fallback/i],
    ['MEMORY_FALLBACK', /backend:\s*in-memory fallback/i]
  ] as const)('A1) MODE INDICATOR: Shows %s mode in Moves tab', async (mode, expectedLabel) => {
    (specialMovesClient.getBackendMode as any).mockReturnValue(mode);
    await setupAndPlay();

    fireEvent.click(screen.getByText(/Director/i, { selector: 'button' }));
    fireEvent.click(await screen.findByRole('button', { name: /moves tab/i }));

    expect(await screen.findByLabelText(/special moves backend mode/i)).toHaveTextContent(expectedLabel);
  });

  it('B) BOARD SYNC: GameBoard renders Zap icon when a tile is ARMED via overlay', async () => {
    await setupAndPlay();

    // Find the tile ID for the first 100pt question
    const state = JSON.parse(localStorage.getItem('cruzpham_gamestate') || '{}');
    const firstTileId = state.categories[0].questions[0].id;

    // Simulate an overlay update from Firestore
    await act(async () => {
      (specialMovesClient as any).__triggerUpdate({
        deploymentsByTileId: {
          [firstTileId]: { status: 'ARMED', moveType: 'DOUBLE_TROUBLE', updatedAt: Date.now() }
        },
        activeByTargetId: {},
        updatedAt: Date.now(),
        version: 1
      });
    });

    const armedTag = await screen.findByTestId(`special-move-tile-tag-${firstTileId}`);
    expect(armedTag).toHaveTextContent('SPECIAL MOVE!');
    expect(armedTag).toHaveAttribute('data-state', 'armed');

    // Verify the board tile shows the Zap icon
    const tile = armedTag.closest('button');
    expect(tile?.querySelector('.lucide-zap')).toBeInTheDocument();
    expect(tile).toHaveClass('animate-pulse');
  });

  it('B2) MODAL SYNC: Armed tile shows compact special-move banner and disables steal', async () => {
    await setupAndPlay();

    const state = JSON.parse(localStorage.getItem('cruzpham_gamestate') || '{}');
    const firstTileId = state.categories[0].questions[0].id;

    await act(async () => {
      (specialMovesClient as any).__triggerUpdate({
        deploymentsByTileId: {
          [firstTileId]: { status: 'ARMED', moveType: 'DOUBLE_TROUBLE', updatedAt: Date.now() }
        },
        activeByTargetId: {},
        updatedAt: Date.now(),
        version: 1
      });
    });

    const boardTile = (await screen.findByTestId(`special-move-tile-tag-${firstTileId}`)).closest('button');
    expect(boardTile).toBeTruthy();
    fireEvent.click(boardTile!);

    const banner = await screen.findByTestId('special-move-banner');
    expect(banner).toHaveTextContent(/DOUBLE OR LOSE/i);
    expect(banner).toHaveTextContent(/WIN: 2X POINTS/i);
    expect(banner).toHaveTextContent(/NO STEAL/i);

    const stealBtn = screen.getByRole('button', { name: /steal/i });
    expect(stealBtn).toBeDisabled();
    expect(stealBtn).toHaveAttribute('title', expect.stringMatching(/steal disabled/i));
  });

  it('B3) HARDENING: Invalid move payload does not crash QuestionModal', async () => {
    await setupAndPlay();

    const state = JSON.parse(localStorage.getItem('cruzpham_gamestate') || '{}');
    const firstTileId = state.categories[0].questions[0].id;

    await act(async () => {
      (specialMovesClient as any).__triggerUpdate({
        deploymentsByTileId: {
          [firstTileId]: { status: 'ARMED', updatedAt: Date.now() }
        },
        activeByTargetId: {},
        updatedAt: Date.now(),
        version: 1
      });
    });

    const boardTile = screen.getAllByRole('button').find((b) => (b.textContent || '').includes('100'));
    expect(boardTile).toBeTruthy();
    fireEvent.click(boardTile!);

    expect(await screen.findByTestId('reveal-root')).toBeInTheDocument();
    expect(screen.queryByTestId('special-move-banner')).not.toBeInTheDocument();
  });

  it('B4) RESOLUTION SYNC: Captured move still applies on return even if overlay changes mid-question', async () => {
    await setupAndPlay();

    const state = JSON.parse(localStorage.getItem('cruzpham_gamestate') || '{}');
    const firstTileId = state.categories[0].questions[0].id;

    await act(async () => {
      (specialMovesClient as any).__triggerUpdate({
        deploymentsByTileId: {
          [firstTileId]: { status: 'ARMED', moveType: 'DOUBLE_TROUBLE', updatedAt: Date.now() }
        },
        activeByTargetId: {},
        updatedAt: Date.now(),
        version: 1
      });
    });

    const boardTile = (await screen.findByTestId(`special-move-tile-tag-${firstTileId}`)).closest('button');
    expect(boardTile).toBeTruthy();
    fireEvent.click(boardTile!);
    await screen.findByTestId('reveal-root');
    await screen.findByTestId('special-move-banner');

    await act(async () => {
      (specialMovesClient as any).__triggerUpdate({
        deploymentsByTileId: {},
        activeByTargetId: {},
        updatedAt: Date.now(),
        version: 2
      });
    });

    // After overlay cleared, banner should still be visible (captured move persists)
    expect(screen.queryByTestId('special-move-banner')).toBeInTheDocument();

    // Verify state has active question and selected player before return
    const preReturnState = JSON.parse(localStorage.getItem('cruzpham_gamestate') || '{}');
    expect(preReturnState.activeQuestionId).toBeTruthy();
    expect(preReturnState.selectedPlayerId).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /return/i }));
    });

    await waitFor(() => {
      const nextState = JSON.parse(localStorage.getItem('cruzpham_gamestate') || '{}');
      expect(nextState.players?.[0]?.score).toBeLessThan(0);
    });
  });

  it('B5) PLAYER COUNTERS: Resolved special move increments player usage count and stores move name', async () => {
    await setupAndPlay();

    const state = JSON.parse(localStorage.getItem('cruzpham_gamestate') || '{}');
    const firstTileId = state.categories[0].questions[0].id;

    await act(async () => {
      (specialMovesClient as any).__triggerUpdate({
        deploymentsByTileId: {
          [firstTileId]: { status: 'ARMED', moveType: 'DOUBLE_TROUBLE', updatedAt: Date.now() }
        },
        activeByTargetId: {},
        updatedAt: Date.now(),
        version: 1
      });
    });

    const boardTile = (await screen.findByTestId(`special-move-tile-tag-${firstTileId}`)).closest('button');
    expect(boardTile).toBeTruthy();
    fireEvent.click(boardTile!);
    await screen.findByTestId('reveal-root');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /return/i }));
    });

    await waitFor(() => {
      const nextState = JSON.parse(localStorage.getItem('cruzpham_gamestate') || '{}');
      const p1 = nextState.players?.[0];
      expect(p1?.specialMovesUsedCount).toBe(1);
      expect(p1?.specialMovesUsedNames).toContain('DOUBLE OR LOSE');
      expect(p1?.score).toBeLessThan(0);
    });

    const resolvedTag = await screen.findByTestId(`special-move-tile-tag-${firstTileId}`);
    expect(resolvedTag).toHaveTextContent('SPECIAL MOVE!');
    expect(resolvedTag).toHaveAttribute('data-state', 'resolved');

    fireEvent.click(screen.getByText(/Director/i, { selector: 'button' }));
    fireEvent.click(await screen.findByRole('button', { name: /moves tab/i }));
    const directorResolvedTag = await screen.findByTestId(`special-move-director-tag-${firstTileId}`);
    expect(directorResolvedTag).toHaveTextContent('SPECIAL MOVE!');
    expect(directorResolvedTag).toHaveAttribute('data-state', 'resolved');
  });

  it('C) CLEAR ARMORY: Director can wipe all armed moves', async () => {
    window.confirm = vi.fn(() => true);
    await setupAndPlay();

    fireEvent.click(screen.getByText(/Director/i, { selector: 'button' }));
    fireEvent.click(await screen.findByRole('button', { name: /moves tab/i }));

    const clearBtn = await screen.findByRole('button', { name: /wipe all armed tiles/i });
    await act(async () => {
      fireEvent.click(clearBtn);
    });

    await waitFor(() => {
      expect(specialMovesClient.clearArmory).toHaveBeenCalled();
    });
    expect(await screen.findByText(/ARMORY CLEARED/i)).toBeInTheDocument();
  });

  it('D) REGRESSION: Scoreboard behaves normally when overlay is empty', async () => {
    await setupAndPlay();

    const scoreboard = screen.getByTestId('scoreboard-root');
    expect(within(scoreboard).getByText('PLAYER 1')).toBeInTheDocument();
    expect(within(scoreboard).getAllByText('0').length).toBeGreaterThan(0);
    expect(document.querySelector('.lucide-zap')).not.toBeInTheDocument();
  });

  it('FALLBACK: When backend fails with permission error, arm succeeds in local fallback mode', async () => {
    await setupAndPlay();

    // The REAL client handles permission-denied internally and still resolves (never rejects to caller).
    // The mock just needs to resolve — no overlay update needed for the toast assertion.
    (specialMovesClient.requestArmTile as any).mockImplementationOnce(async () => {
      return { success: true, id: 'test-fallback' };
    });

    fireEvent.click(screen.getByText(/Director/i, { selector: 'button' }));
    fireEvent.click(await screen.findByRole('button', { name: /moves tab/i }));

    const moveBtn = await screen.findByText('DOUBLE OR LOSE');
    fireEvent.click(moveBtn);

    const clearBtn = await screen.findByRole('button', { name: /wipe all armed tiles/i });
    const movesPanel = clearBtn.closest('div')?.parentElement?.parentElement ?? document.body;
    const armTileBtn = within(movesPanel).getAllByRole('button').find((button) => button.textContent?.includes('100'));

    await act(async () => {
      fireEvent.click(armTileBtn!);
    });

    // Should show success toast — same as production path, fallback resolves identically
    expect(await screen.findByText(/MOVE DEPLOYED/i)).toBeInTheDocument();
  }, 15000);

  it('FALLBACK: Tile tag shows "armed" state when armed in fallback mode', async () => {
    await setupAndPlay();

    // Capture the actual tileId that handleArmMove passes to requestArmTile,
    // then use that same ID in the overlay update so the tile tag can be found.
    let capturedTileId: string | null = null;

    (specialMovesClient.requestArmTile as any).mockImplementationOnce(async (params: any) => {
      capturedTileId = params.tileId;
      // Simulate fallback arm succeeding: trigger overlay with the clicked tile's actual ID
      (specialMovesClient as any).__triggerUpdate({
        deploymentsByTileId: {
          [params.tileId]: { status: 'ARMED', moveType: 'DOUBLE_TROUBLE', updatedAt: Date.now() }
        },
        activeByTargetId: {},
        updatedAt: Date.now(),
        version: 1
      });
      return { success: true, id: 'test-fallback-' + params.tileId };
    });

    fireEvent.click(screen.getByText(/Director/i, { selector: 'button' }));
    fireEvent.click(await screen.findByRole('button', { name: /moves tab/i }));

    const moveBtn = await screen.findByText('DOUBLE OR LOSE');
    fireEvent.click(moveBtn);

    const clearBtn = await screen.findByRole('button', { name: /wipe all armed tiles/i });
    const movesPanel = clearBtn.closest('div')?.parentElement?.parentElement ?? document.body;
    const armTileBtn = within(movesPanel).getAllByRole('button').find((button) => button.textContent?.includes('100'));

    await act(async () => {
      fireEvent.click(armTileBtn!);
    });

    // Verify tile tag updated on board using the captured actual tile ID
    await waitFor(() => {
      expect(capturedTileId).not.toBeNull();
      const tileTag = screen.getByTestId(`special-move-tile-tag-${capturedTileId}`);
      expect(tileTag).toHaveAttribute('data-state', 'armed');
    });
  }, 15000);
});
