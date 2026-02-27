class AppDialogService {
  constructor() {
    this.presenter = null;
    this.nativeAlert = null;
  }

  setPresenter(presenter) {
    this.presenter = presenter;
    return () => {
      if (this.presenter === presenter) {
        this.presenter = null;
      }
    };
  }

  setNativeAlert(nativeAlert) {
    this.nativeAlert = nativeAlert;
  }

  alert(title, message, buttonsOrOptions, optionsArg) {
    let buttons = buttonsOrOptions;
    let options = optionsArg;
    if (
      buttonsOrOptions &&
      !Array.isArray(buttonsOrOptions) &&
      typeof buttonsOrOptions === 'object'
    ) {
      buttons = null;
      options = buttonsOrOptions;
    }

    const payload = {
      title: String(title || '').trim(),
      message: String(message || '').trim(),
      buttons: Array.isArray(buttons) && buttons.length > 0 ? buttons : null,
      options: options && typeof options === 'object' ? options : {},
    };

    if (this.presenter) {
      this.presenter(payload);
      return;
    }

    if (typeof this.nativeAlert === 'function') {
      this.nativeAlert(title, message, buttonsOrOptions, optionsArg);
    }
  }
}

export default new AppDialogService();
