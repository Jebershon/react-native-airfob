package android.content;
import android.content.pm.PackageManager;
import java.io.File;
public abstract class Context {
  public static final String BLUETOOTH_SERVICE = "bluetooth";
  public static final String LOCATION_SERVICE = "location";
  public static final String POWER_SERVICE = "power";
  public static final int MODE_PRIVATE = 0;
  public abstract Object getSystemService(String name);
  public abstract SharedPreferences getSharedPreferences(String name, int mode);
  public abstract String getPackageName();
  public abstract File getFilesDir();
  public abstract File getCacheDir();
  public abstract void startActivity(Intent intent);
  public abstract Context getApplicationContext();
  public abstract PackageManager getPackageManager();
  public abstract int checkPermission(String permission, int pid, int uid);
  public abstract int checkSelfPermission(String permission);
}
