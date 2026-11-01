import { useProStore } from '../../features/pro/proStore';
import { resetStores } from '../testFixtures';

describe('resetStores', () => {
  it('resets the Pro store to its initial (loading) state', () => {
    useProStore.setState({ status: 'pro', source: 'revenuecat' });
    expect(useProStore.getState().status).toBe('pro');

    resetStores();

    expect(useProStore.getState()).toMatchObject({ status: 'loading', source: 'pending' });
    expect(typeof useProStore.getState().init).toBe('function');
  });
});
