import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import OperatingDemandsPage, { DemandTodoButton } from './OperatingDemandsPage';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('defaults to Amazon, keeps one shared image requirement, and accepts a reference upload', async () => {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (['/api/demands', '/api/demand-presets', '/api/accounts/assignable'].includes(url)) return new Response('[]', { status: 200 });
    if (url === '/api/assets') return new Response(JSON.stringify({ id: _init?.headers && (_init.headers as Record<string, string>)['X-File-Name'] === 'reference.png' ? '00000000-0000-4000-8000-000000000044' : '00000000-0000-4000-8000-000000000042' }), { status: 201 });
    throw new Error(`Unexpected ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<OperatingDemandsPage language="en-US" username="operator" admin={false} toolOptions={[]} onOpenTool={() => {}} />);
  expect(await screen.findByText('Image production requests')).toBeInTheDocument();
  expect(screen.getByText('Image presets')).toBeInTheDocument();
  expect(screen.queryByText('Accounts')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /New request/ }));
  expect(await screen.findByText('Image production brief')).toBeInTheDocument();
  const labels = Array.from(document.querySelectorAll('.ant-drawer .ant-form-item-label')).map((element) => element.textContent);
  expect(labels.slice(0, 3)).toEqual(['Platform', 'Image type', 'Image preset (optional override)']);
  expect(screen.queryByText('Title (optional)')).not.toBeInTheDocument();
  expect(screen.getByText('Image requirements')).toBeInTheDocument();
  expect(document.querySelector('.ant-drawer .operating-platform-option')?.textContent).toBe('AMAZON');
  expect(screen.queryByPlaceholderText('Instructions applying to every finished image')).not.toBeInTheDocument();
  expect(screen.getByText('Upload assets')).toBeInTheDocument();
  expect(screen.getAllByText('Drag, click, or paste source images').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Drag, click, or paste reference images').length).toBeGreaterThan(0);
  const sourcePicker = document.querySelector('.operating-upload-grid input[type="file"]') as HTMLInputElement;
  expect(sourcePicker).toBeTruthy();
  fireEvent.change(sourcePicker, { target: { files: [new File(['png'], 'brief.png', { type: 'image/png' })] } });
  expect(await screen.findByText('brief.png')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Save request/ }));
  expect(fetchMock.mock.calls.filter(([url, init]) => url === '/api/demands' && init?.method === 'POST')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: 'Add image-specific requirements' })).not.toBeInTheDocument();
  const referencePicker = document.querySelector('.operating-reference-grid input[type="file"]') as HTMLInputElement;
  fireEvent.change(referencePicker, { target: { files: [new File(['png'], 'reference.png', { type: 'image/png' })] } });
  expect(await screen.findByText('reference.png')).toBeInTheDocument();
  expect(screen.getByText('Select a type or enter your own; AI recognizes black-and-white logos automatically.')).toBeInTheDocument();
  fireEvent.mouseDown(screen.getAllByRole('combobox')[1]);
  expect(await screen.findByText('Logo design')).toBeInTheDocument();
  expect(screen.queryByText('Custom logo')).not.toBeInTheDocument();
}, 45_000);

it('resets only the current draft after confirmation', async () => {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url === '/api/assets') return new Response(JSON.stringify({ id: '00000000-0000-4000-8000-000000000043' }), { status: 201 });
    return new Response('[]', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<OperatingDemandsPage language="en-US" username="operator" admin={false} toolOptions={[]} onOpenTool={() => {}} />);
  await screen.findByText('Image production requests');
  fireEvent.click(screen.getByRole('button', { name: /New request/ }));
  const brief = screen.getByText('Image production brief').closest('.ant-form-item')!.querySelector('textarea')!;
  fireEvent.change(brief, { target: { value: 'A scene with warm light' } });
  const picker = document.querySelector('.operating-upload-grid input[type="file"]') as HTMLInputElement;
  fireEvent.change(picker, { target: { files: [new File(['png'], 'scene.png', { type: 'image/png' })] } });
  expect(await screen.findByText('scene.png')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Reset/ }));
  expect(await screen.findByText('Reset the current form?')).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: /Reset/ }).at(-1)!);
  fireEvent.click(screen.getByRole('button', { name: /New request/ }));
  expect(screen.queryByText('scene.png')).not.toBeInTheDocument();
  expect(screen.getByText('Image production brief').closest('.ant-form-item')!.querySelector('textarea')!.value).toBe('');
  expect(fetchMock.mock.calls.filter(([url, init]) => url === '/api/demands' && init?.method === 'POST')).toHaveLength(0);
}, 45_000);

it('offers a matching preset after type and platform selection and previews its fields before replacing typed requirements', async () => {
  const presets = [{ id: '00000000-0000-4000-8000-000000000001', type: 'main', platform: 'AMAZON', name: 'Amazon main image', nameZh: '亚马逊首图', requirements: [{ content: 'White background', width: 2000, height: 2000, dpi: 300, maxMB: 10 }] }];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url === '/api/demand-presets' ? presets : []), { status: 200 })));
  render(<OperatingDemandsPage language="en-US" username="operator" admin={false} toolOptions={[]} onOpenTool={() => {}} />);
  await screen.findByText('Image production requests');
  fireEvent.click(screen.getByRole('button', { name: /New request/ }));
  const brief = screen.getByText('Image production brief').closest('.ant-form-item')!.querySelector('textarea')!;
  fireEvent.change(brief, { target: { value: 'Keep the product centered' } });
  expect(screen.getByDisplayValue('Keep the product centered')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Image count' }), { target: { value: '2' } });
  fireEvent.mouseDown(screen.getAllByRole('combobox')[1]);
  fireEvent.click((await screen.findAllByText('Main image')).find((node) => node.closest('.ant-select-item-option'))!.closest('.ant-select-item-option')!);
  expect((await screen.findAllByText('Apply preset and replace existing image requirements?')).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/2000 × 2000 px/).length).toBeGreaterThan(0);
  fireEvent.click(screen.getAllByRole('button', { name: 'Apply preset' }).at(-1)!);
  expect(screen.getByText('Image production brief').closest('.ant-form-item')!.querySelector('textarea')!.value).toBe('Keep the product centered\nWhite background');
  expect(screen.getByPlaceholderText('Width')).toHaveValue('2000');
}, 20_000);

it('saves a custom image type and NAS folder without a user-entered title', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/demands' && init?.method === 'POST') return new Response('{}', { status: 201 });
    return new Response('[]', { status: 200 });
  });
  const open = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('open', open);
  render(<OperatingDemandsPage language="en-US" username="operator" admin={false} toolOptions={[]} onOpenTool={() => {}} />);
  await screen.findByText('Image production requests');
  fireEvent.click(screen.getByRole('button', { name: /New request/ }));
  const typeInput = screen.getByText('Image type').closest('.ant-form-item')!.querySelector('input')!;
  fireEvent.change(typeInput, { target: { value: 'Packaging insert' } });
  expect(typeInput).toHaveValue('Packaging insert');
  fireEvent.change(screen.getByText('Image production brief').closest('.ant-form-item')!.querySelector('textarea')!, { target: { value: 'Create a branded insert' } });
  fireEvent.change(screen.getByPlaceholderText(/Local or NAS folder/), { target: { value: '\\\\NAS\\share\\art' } });
  fireEvent.click(screen.getByRole('button', { name: /Add local path/ }));
  const folderButton = screen.getByRole('button', { name: /NAS\\share\\art/ });
  fireEvent.click(folderButton);
  expect(open).toHaveBeenCalledWith('file://NAS/share/art', '_blank');
  fireEvent.click(screen.getByRole('button', { name: /Save request/ }));
  expect(screen.queryByText('Select an image type and platform first')).not.toBeInTheDocument();
  await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/demands' && init?.method === 'POST')).toBe(true));
  const [, request] = fetchMock.mock.calls.find(([url, init]) => url === '/api/demands' && init?.method === 'POST')!;
  const body = JSON.parse(String(request?.body));
  expect(body.content).toMatchObject({ type: 'Packaging insert', platform: 'AMAZON', title: '', localPaths: ['\\\\NAS\\share\\art'], specifications: [] });
}, 30_000);

it('keeps an assigned request in the to-do menu until manually completed', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ id: 'demand-1', content: { title: 'Hero scene', description: 'scene' } }]), { status: 200 })));
  const open = vi.fn();
  render(<DemandTodoButton language="en-US" onOpen={open} />);
  const button = await screen.findByRole('button', { name: /To-dos/ });
  fireEvent.click(button);
  fireEvent.click(await screen.findByText('Hero scene'));
  expect(open).toHaveBeenCalledWith('demand-1');
});
