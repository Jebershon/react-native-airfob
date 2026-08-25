package android.content;
public interface SharedPreferences {
  Editor edit();
  String getString(String key, String defValue);
  interface Editor {
    Editor putString(String key, String value);
    void apply();
  }
}
