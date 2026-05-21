import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MediaLibrary } from '@/components/Workspace/LeftPanel/MediaLibrary';
import { useAppStore } from '@/lib/store';

vi.mock('@/lib/storage/r2-adapter', () => ({
  createR2StorageAdapter: () => ({
    uploadImage: vi.fn().mockResolvedValue({
      id: 'm1',
      kind: 'image',
      url: 'https://x/m1.jpg',
      filename: 'a.jpg',
      uploadedAt: '2026-05-19T00:00:00.000Z'
    }),
    uploadAudio: vi.fn().mockResolvedValue({
      id: 'm2',
      kind: 'audio',
      url: 'https://x/m2.mp3',
      filename: 'b.mp3',
      uploadedAt: '2026-05-19T00:00:00.000Z'
    })
  })
}));

describe('MediaLibrary', () => {
  beforeEach(() => {
    useAppStore.setState({ media: { mediaRefs: [] } });
  });

  it('renders existing media refs', () => {
    useAppStore.setState({
      media: {
        mediaRefs: [
          {
            id: 'm0',
            kind: 'image',
            url: 'https://x/0.jpg',
            filename: 'x.jpg',
            width: 100,
            height: 50,
            uploadedAt: '2026-05-19T00:00:00.000Z'
          }
        ]
      }
    });
    render(<MediaLibrary />);
    expect(screen.getByText('x.jpg')).toBeInTheDocument();
    expect(screen.getByText('100×50')).toBeInTheDocument();
  });

  it('uploading an image calls adapter and stores the ref', async () => {
    const { container } = render(<MediaLibrary />);
    const imageInput = container.querySelector(
      'input[type=file][accept*="image/jpeg"]'
    ) as HTMLInputElement;
    const file = new File([new Uint8Array([0xff, 0xd8])], 'a.jpg', { type: 'image/jpeg' });
    Object.defineProperty(imageInput, 'files', { value: [file] });
    fireEvent.change(imageInput);
    await waitFor(() => {
      expect(useAppStore.getState().media.mediaRefs).toHaveLength(1);
    });
  });

  it('drag-start sets the correct dataTransfer type', () => {
    useAppStore.setState({
      media: {
        mediaRefs: [
          {
            id: 'm0',
            kind: 'image',
            url: 'https://x/0.jpg',
            filename: 'x.jpg',
            uploadedAt: '2026-05-19T00:00:00.000Z'
          }
        ]
      }
    });
    const { container } = render(<MediaLibrary />);
    const item = container.querySelector('li')!;
    const setData = vi.fn();
    fireEvent.dragStart(item, { dataTransfer: { setData } });
    expect(setData).toHaveBeenCalledWith('application/x-vibegrid-media-image', 'm0');
  });

  it('renders the + Video upload button (Plan 5.9b)', () => {
    render(<MediaLibrary />);
    expect(screen.getByText('+ Video')).toBeInTheDocument();
  });

  it('renders a video tile with the ▶ + duration badge and thumbnail', () => {
    useAppStore.setState({
      media: {
        mediaRefs: [
          {
            id: 'v0',
            kind: 'video',
            url: 'https://x/v.mp4',
            filename: 'clip.mp4',
            uploadedAt: '2026-05-21T00:00:00.000Z',
            duration: 107, // 1:47
            thumbnailUrl: 'data:image/jpeg;base64,/9j/'
          }
        ]
      }
    });
    render(<MediaLibrary />);
    expect(screen.getByText('clip.mp4')).toBeInTheDocument();
    expect(screen.getByText(/▶ 1:47/)).toBeInTheDocument();
    const thumb = screen.getByAltText('') as HTMLImageElement;
    expect(thumb.src.startsWith('data:image/jpeg')).toBe(true);
  });

  it('video tile drag-start uses the x-vibegrid-media-video data type', () => {
    useAppStore.setState({
      media: {
        mediaRefs: [
          {
            id: 'v0',
            kind: 'video',
            url: 'https://x/v.mp4',
            filename: 'clip.mp4',
            uploadedAt: '2026-05-21T00:00:00.000Z',
            duration: 30
          }
        ]
      }
    });
    const { container } = render(<MediaLibrary />);
    const item = container.querySelector('li')!;
    const setData = vi.fn();
    fireEvent.dragStart(item, { dataTransfer: { setData } });
    expect(setData).toHaveBeenCalledWith('application/x-vibegrid-media-video', 'v0');
  });
});
