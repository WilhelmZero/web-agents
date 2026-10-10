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
  expect(screen.getByText('Upload images and set their purpose')).toBeInTheDocument();
  expect(screen.getByText('Requirements per image')).toBeInTheDocument();
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
