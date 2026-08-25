package android.content;
import android.content.pm.PackageManager;
import java.io.File;
public class ContextWrapper extends Context {
  public ContextWrapper(Context base) {}
  public Object getSystemService(String name) { return null; }
  public SharedPreferences getSharedPreferences(String name, int mode) { return null; }
  public String getPackageName() { return null; }
  public File getFilesDir() { return null; }
  public File getCacheDir() { return null; }
  public void startActivity(Intent intent) {}
  public Context getApplicationContext() { return null; }
  public PackageManager getPackageManager() { return null; }
  public int checkPermission(String p, int pid, int uid) { return 0; }
  public int checkSelfPermission(String p) { return 0; }
}
