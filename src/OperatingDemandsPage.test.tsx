import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import OperatingDemandsPage, { DemandTodoButton } from './OperatingDemandsPage';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('shows the bilingual operations page and optional request controls', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (['/api/demands', '/api/demand-presets', '/api/accounts/assignable'].includes(url)) return new Response('[]', { status: 200 });
    throw new Error(`Unexpected ${url}`);
  }));
  render(<OperatingDemandsPage language="en-US" username="operator" admin={false} toolOptions={[]} onOpenTool={() => {}} />);
  expect(await screen.findByText('Image production requests')).toBeInTheDocument();
  expect(screen.getByText('Image presets')).toBeInTheDocument();
  expect(screen.queryByText('Accounts')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /New request/ }));
  expect(await screen.findByText('Image production brief')).toBeInTheDocument();
  expect(screen.getByText('Requirements for all images')).toBeInTheDocument();
  expect(screen.getByText('Upload assets')).toBeInTheDocument();
  expect(screen.getByText('Upload source images')).toBeInTheDocument();
  expect(screen.getByText('Upload style references')).toBeInTheDocument();
  expect(screen.queryByText('Image 1 overrides')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Add requirements for one image/ }));
  expect(screen.getByText('Image 1 overrides')).toBeInTheDocument();
  expect(screen.getByText('Black-and-white logo requests are recognized from the brief; no separate type is needed.')).toBeInTheDocument();
  fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
  expect(await screen.findByText('Logo design')).toBeInTheDocument();
  expect(screen.queryByText('Custom logo')).not.toBeInTheDocument();
}, 20_000);

it('offers a matching preset after type and platform selection and previews its fields before replacing typed requirements', async () => {
  const presets = [{ id: '00000000-0000-4000-8000-000000000001', type: 'main', platform: 'AMAZON', name: 'Amazon main image', nameZh: '亚马逊首图', requirements: [{ content: 'White background', width: 2000, height: 2000, dpi: 300, maxMB: 10 }] }];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url === '/api/demand-presets' ? presets : []), { status: 200 })));
  render(<OperatingDemandsPage language="en-US" username="operator" admin={false} toolOptions={[]} onOpenTool={() => {}} />);
  await screen.findByText('Image production requests');
  fireEvent.click(screen.getByRole('button', { name: /New request/ }));
  fireEvent.change(screen.getByPlaceholderText('Instructions applying to every finished image'), { target: { value: 'Keep my manual requirements' } });
  fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
  fireEvent.click((await screen.findAllByText('Main image')).find((node) => node.closest('.ant-select-item-option'))!.closest('.ant-select-item-option')!);
  fireEvent.mouseDown(screen.getAllByRole('combobox')[1]);
  fireEvent.click(screen.getAllByText('AMAZON').find((node) => node.closest('.ant-select-item-option'))!.closest('.ant-select-item-option')!);
  expect((await screen.findAllByText('Apply preset and replace existing image requirements?')).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/2000 × 2000 px/).length).toBeGreaterThan(0);
  fireEvent.click(screen.getAllByRole('button', { name: 'Apply preset' }).at(-1)!);
  expect(await screen.findByDisplayValue('White background')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Width')).toHaveValue('2000');
}, 20_000);

it('keeps an assigned request in the to-do menu until manually completed', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ id: 'demand-1', content: { title: 'Hero scene', description: 'scene' } }]), { status: 200 })));
  const open = vi.fn();
  render(<DemandTodoButton language="en-US" onOpen={open} />);
  const button = await screen.findByRole('button', { name: /To-dos/ });
  fireEvent.click(button);
  fireEvent.click(await screen.findByText('Hero scene'));
  expect(open).toHaveBeenCalledWith('demand-1');
});
