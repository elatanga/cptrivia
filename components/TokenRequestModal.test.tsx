import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, test, expect, beforeEach } from 'vitest';
import { TokenRequestModal } from './TokenRequestModal';
import { authService } from '../services/authService';
import { AppError } from '../types';

describe('TokenRequestModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('submits the request with optional email and shows the success state', async () => {
    const submitSpy = vi.spyOn(authService, 'submitTokenRequest').mockResolvedValue({
      id: 'REQ-EMAIL-1',
      firstName: 'Jamie',
      lastName: 'Stone',
      tiktokHandle: 'jamie.live',
      preferredUsername: 'jamie.stone',
      phoneE164: '+15551112222',
      email: 'jamie@example.com',
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      adminNotifyStatus: 'PENDING',
      userNotifyStatus: 'PENDING',
      delivery: {},
    });

    const onClose = vi.fn();
    const onSuccess = vi.fn();

    render(<TokenRequestModal onClose={onClose} onSuccess={onSuccess} />);

    fireEvent.change(screen.getByLabelText(/First Name/i), { target: { value: 'Jamie' } });
    fireEvent.change(screen.getByLabelText(/Last Name/i), { target: { value: 'Stone' } });
    fireEvent.change(screen.getByLabelText(/TikTok Handle/i), { target: { value: 'jamie.live' } });
    fireEvent.change(screen.getByLabelText(/Preferred Username/i), { target: { value: 'jamie.stone' } });
    fireEvent.change(screen.getByLabelText(/Phone Number/i), { target: { value: '+15551112222' } });
    fireEvent.change(screen.getByLabelText(/Email \(Optional\)/i), { target: { value: 'jamie@example.com' } });

    fireEvent.click(screen.getByRole('button', { name: /Send Request/i }));

    await waitFor(() => {
      expect(screen.getByText(/Request Received/i)).toBeInTheDocument();
    });

    expect(submitSpy).toHaveBeenCalledWith({
      firstName: 'Jamie',
      lastName: 'Stone',
      tiktokHandle: 'jamie.live',
      preferredUsername: 'jamie.stone',
      phoneE164: '+15551112222',
      email: 'jamie@example.com',
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(screen.getByText('REQ-EMAIL-1')).toBeInTheDocument();
  });

  test('renders duplicate-request validation errors returned by the service', async () => {
    vi.spyOn(authService, 'submitTokenRequest').mockRejectedValue(
      new AppError('ERR_DUPLICATE_REQUEST', 'A pending access request already exists for this phone number or username.')
    );

    render(<TokenRequestModal onClose={vi.fn()} onSuccess={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/First Name/i), { target: { value: 'Jamie' } });
    fireEvent.change(screen.getByLabelText(/Last Name/i), { target: { value: 'Stone' } });
    fireEvent.change(screen.getByLabelText(/TikTok Handle/i), { target: { value: 'jamie.live' } });
    fireEvent.change(screen.getByLabelText(/Preferred Username/i), { target: { value: 'jamie.stone' } });
    fireEvent.change(screen.getByLabelText(/Phone Number/i), { target: { value: '+15551112222' } });

    fireEvent.click(screen.getByRole('button', { name: /Send Request/i }));

    await waitFor(() => {
      expect(screen.getByText(/pending access request already exists/i)).toBeInTheDocument();
    });
  });
});

