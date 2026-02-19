import NetInfo from '@react-native-community/netinfo';

class NetworkService {
  constructor() {
    this.isConnected = false;
    this.connectionType = 'unknown';
    this.listeners = [];
  }

  initialize() {
    // Subscribe to network state updates
    this.unsubscribe = NetInfo.addEventListener(state => {
      this.isConnected = state.isConnected;
      this.connectionType = state.type;
      
      console.log('📡 Network state:', {
        isConnected: state.isConnected,
        type: state.type,
      });

      // Notify all listeners
      this.listeners.forEach(listener => listener(state));
    });
  }

  async checkOnlineStatus() {
    try {
      const state = await NetInfo.fetch();
      this.isConnected = state.isConnected;
      this.connectionType = state.type;
      return state.isConnected;
    } catch (error) {
      console.error('❌ Error checking network status:', error);
      return false;
    }
  }

  addListener(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  cleanup() {
    if (this.unsubscribe) {
      this.unsubscribe();
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
    return state.isConnected;
  } catch (error) {
    console.error('❌ Error checking online status:', error);
    throw new Error('No internet connection');
  }
};

export default new NetworkService();