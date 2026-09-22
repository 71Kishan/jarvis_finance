// Browser System Notification and Vibration Service for Android & Desktop

export type NotificationPermissionState = "default" | "granted" | "denied" | "unsupported";

class SystemNotificationService {
  private permission: NotificationPermissionState = "default";

  constructor() {
    if (typeof window !== "undefined" && "Notification" in window) {
      this.permission = Notification.permission as NotificationPermissionState;
    } else {
      this.permission = "unsupported";
    }
  }

  public getPermission(): NotificationPermissionState {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return "unsupported";
    }
    return Notification.permission as NotificationPermissionState;
  }

  public async requestPermission(): Promise<NotificationPermissionState> {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return "unsupported";
    }

    try {
      const result = await Notification.requestPermission();
      this.permission = result as NotificationPermissionState;
      return this.permission;
    } catch (e) {
      console.warn("[Notifications] Permission request error:", e);
      return this.permission;
    }
  }

  /**
   * Dispatches system push/banner notification to Android system notification shade or desktop notification center
   */
  public async notify(title: string, options?: {
    body?: string;
    icon?: string;
    badge?: string;
    tag?: string;
    vibrate?: number[];
    data?: any;
  }) {
    if (typeof window === "undefined") return;

    // Haptic vibration on Android devices if supported
    if ("vibrate" in navigator && options?.vibrate) {
      try {
        navigator.vibrate(options.vibrate);
      } catch {}
    }

    if (!("Notification" in window) || Notification.permission !== "granted") {
      return;
    }

    const defaultIcon = "/icon-192.png";
    const notificationOptions: NotificationOptions = {
      body: options?.body || "",
      icon: options?.icon || defaultIcon,
      badge: options?.badge || defaultIcon,
      tag: options?.tag || `trade-alert-${Date.now()}`,
      data: options?.data,
    };

    // Prefer ServiceWorkerRegistration.showNotification if service worker is active (works better on Android PWA)
    if ("serviceWorker" in navigator) {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration && registration.showNotification) {
          await registration.showNotification(title, notificationOptions);
          return;
        }
      } catch (err) {
        // Fallback to standard Notification constructor
      }
    }

    try {
      new Notification(title, notificationOptions);
    } catch (e) {
      // In some mobile browsers, window.Notification constructor requires a service worker
    }
  }

  public triggerHaptic(type: "LIGHT" | "SUCCESS" | "WARNING" | "DANGER") {
    if (typeof window === "undefined" || !("vibrate" in navigator)) return;
    try {
      switch (type) {
        case "LIGHT":
          navigator.vibrate(25);
          break;
        case "SUCCESS":
          navigator.vibrate([40, 60, 80]);
          break;
        case "WARNING":
          navigator.vibrate([100, 50, 100]);
          break;
        case "DANGER":
          navigator.vibrate([200, 100, 200, 100, 300]);
          break;
      }
    } catch {}
  }
}

export const systemNotificationService = new SystemNotificationService();
