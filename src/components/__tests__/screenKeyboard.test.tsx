import { act, render, screen } from '@testing-library/react-native';
import { Keyboard, Platform, StyleSheet, Text } from 'react-native';

import { Screen } from '../Screen';

const INSET_BOTTOM = 24;
const GUTTER = 16;

jest.mock('react-native-safe-area-context', () => {
  const mock = require('react-native-safe-area-context/jest/mock').default;
  return { ...mock, useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 24, left: 0 }) };
});

type Listener = () => void;
let listeners: Map<string, Set<Listener>>;
const removed: string[] = [];
const platformOS = Platform.OS;

async function emit(event: string) {
  await act(async () => {
    listeners.get(event)?.forEach((fn) => fn());
  });
}

const footerPadding = () =>
  StyleSheet.flatten(screen.getByTestId('screen-footer').props.style).paddingBottom;

beforeEach(() => {
  Platform.OS = 'android';
  listeners = new Map();
  removed.length = 0;
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false);
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, fn: Listener) => {
    const set = listeners.get(event) ?? new Set<Listener>();
    set.add(fn);
    listeners.set(event, set);
    return {
      remove: () => {
        set.delete(fn);
        removed.push(event);
      },
    };
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  Platform.OS = platformOS;
});

describe('Screen with the soft keyboard', () => {
  it('bottomInset: pads by gutter + inset with the keyboard hidden, gutter only while shown', async () => {
    await render(
      <Screen footer={<Text>Save</Text>} bottomInset>
        <Text>Body</Text>
      </Screen>,
    );
    expect(footerPadding()).toBe(GUTTER + INSET_BOTTOM);

    await emit('keyboardDidShow');
    expect(footerPadding()).toBe(GUTTER);

    await emit('keyboardDidHide');
    expect(footerPadding()).toBe(GUTTER + INSET_BOTTOM);
  });

  it('starts at gutter only when the keyboard is already up', async () => {
    jest.spyOn(Keyboard, 'isVisible').mockReturnValue(true);
    await render(<Screen footer={<Text>Save</Text>} bottomInset />);
    expect(footerPadding()).toBe(GUTTER);
  });

  it('tab screens (no bottomInset): gutter only, keyboard up or down', async () => {
    await render(<Screen footer={<Text>Save</Text>} />);
    expect(footerPadding()).toBe(GUTTER);
    await emit('keyboardDidShow');
    expect(footerPadding()).toBe(GUTTER);
  });

  it('uses the "Will" events on iOS', async () => {
    Platform.OS = 'ios';
    await render(<Screen footer={<Text>Save</Text>} bottomInset />);
    await emit('keyboardWillShow');
    expect(footerPadding()).toBe(GUTTER);
    await emit('keyboardWillHide');
    expect(footerPadding()).toBe(GUTTER + INSET_BOTTOM);
  });

  it('removes its keyboard listeners on unmount', async () => {
    await render(<Screen footer={<Text>Save</Text>} bottomInset />);
    await screen.unmount();
    // Screen's own pair plus the KeyboardAvoidingView's pair, none left behind.
    expect(removed).toEqual(expect.arrayContaining(['keyboardDidShow', 'keyboardDidHide']));
    expect([...listeners.values()].every((set) => set.size === 0)).toBe(true);
  });
});
