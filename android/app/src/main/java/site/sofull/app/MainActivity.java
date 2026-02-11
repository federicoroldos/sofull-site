package site.sofull.app;

import android.content.Intent;
import com.getcapacitor.BridgeActivity;
import ee.forgr.capacitor.social.login.GoogleProvider;
import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;
import ee.forgr.capacitor.social.login.SocialLoginPlugin;

public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {
  @Override
  public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {
    // Marker method required by the social login plugin when using custom scopes.
  }

  @Override
  protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);

    if (requestCode >= GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MIN
        && requestCode <= GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MAX) {
      SocialLoginPlugin plugin = (SocialLoginPlugin) getBridge().getPlugin("SocialLogin");
      if (plugin != null) {
        plugin.handleGoogleLoginIntent(requestCode, data);
      }
    }
  }
}
