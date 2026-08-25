package android.content;
import android.net.Uri;
public class Intent {
  public static final int FLAG_ACTIVITY_NEW_TASK = 0x10000000;
  public Intent() {}
  public Intent(String action) {}
  public Intent addFlags(int flags) { return this; }
  public Intent setData(Uri data) { return this; }
  public Intent putExtra(String name, String value) { return this; }
}
