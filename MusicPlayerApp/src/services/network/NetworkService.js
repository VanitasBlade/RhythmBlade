import NetInfo from '@react-native-community/netinfo';

class NetworkService {
  constructor() {
    this.isConnected = false;
    this.connectionType = 'unknown';
    this.listeners = [];
    this.unsubscribe = null;
  }

  initialize() {
    this.unsubscribe = NetInfo.addEventListener(state => {
      this.isConnected = Boolean(state?.isConnected);
      this.connectionType = state?.type || 'unknown';

      if (__DEV__) {
        console.log('Network state:', {
          isConnected: this.isConnected,
          type: this.connectionType,
        });
      }

      this.listeners.forEach(listener => listener(state));
    });
  }

  async checkOnlineStatus() {
    try {
      const state = await NetInfo.fetch();
      this.isConnected = Boolean(state?.isConnected);
      this.connectionType = state?.type || 'unknown';
      return this.isConnected;
    } catch (error) {
      console.error('Error checking network status:', error);
      return false;
    }
  }

  addListener(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }

    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(item => item !== listener);
    };
  }

  cleanup() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.listeners = [];
  }

  getConnectionType() {
    return this.connectionType;
  }

  getIsConnected() {
    return this.isConnected;
  }
}

export const checkOnlineStatus = async () => {
  try {
    const state = await NetInfo.fetch();
    return Boolean(state?.isConnected);
  } catch (error) {
    console.error('Error checking online status:', error);
    throw new Error('No internet connection');
  }
};

export default new NetworkService();
