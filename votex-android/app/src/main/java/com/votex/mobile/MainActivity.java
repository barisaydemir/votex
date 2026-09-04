package com.votex.mobile;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

/**
 * Votex Mobile — Android WebView wrapper
 * Loads the PWA from assets, provides native GPS bridge
 */
public class MainActivity extends Activity {

    private WebView webView;
    private ProgressBar progressBar;
    private LocationManager locationManager;
    private static final int PERMISSION_REQUEST_CODE = 1001;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Fullscreen immersive
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );

        setContentView(R.layout.activity_main);

        // Status bar color
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setStatusBarColor(Color.parseColor("#131825"));
            getWindow().setNavigationBarColor(Color.parseColor("#131825"));
        }

        progressBar = findViewById(R.id.progressBar);
        webView = findViewById(R.id.webView);

        // WebView settings
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // Enable geolocation
        settings.setGeolocationEnabled(true);

        // JavaScript interface for native GPS
        webView.addJavascriptInterface(new NativeBridge(), "NativeBridge");

        // WebView client
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false; // Load in WebView
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                progressBar.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progressBar.setVisibility(View.GONE);
            }
        });

        // Chrome client for geolocation permissions
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin,
                    GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }
        });

        // Location manager
        locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);

        // Request GPS permissions
        requestPermissions();

        // Load the PWA from assets
        webView.loadUrl("file:///android_asset/index.html");
    }

    /**
     * Request necessary permissions
     */
    private void requestPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                    != PackageManager.PERMISSION_GRANTED ||
                ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION)
                    != PackageManager.PERMISSION_GRANTED) {

                ActivityCompat.requestPermissions(this,
                    new String[]{
                        Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION
                    },
                    PERMISSION_REQUEST_CODE);
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }

    /**
     * Native bridge — provides GPS data to the PWA
     */
    public class NativeBridge {

        @JavascriptInterface
        public void getCurrentPosition() {
            try {
                if (ActivityCompat.checkSelfPermission(MainActivity.this,
                        Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {

                    Location location = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
                    if (location == null) {
                        location = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
                    }

                    if (location != null) {
                        String js = String.format(
                            "window._nativeGPSCallback(%f, %f, %f, %f, %f)",
                            location.getLatitude(),
                            location.getLongitude(),
                            location.getAltitude(),
                            location.getAccuracy(),
                            location.getTime()
                        );
                        runOnUiThread(() -> webView.evaluateJavascript(js, null));
                    } else {
                        // Request fresh location
                        locationManager.requestSingleUpdate(LocationManager.GPS_PROVIDER,
                            new LocationListener() {
                                @Override
                                public void onLocationChanged(Location loc) {
                                    String js = String.format(
                                        "window._nativeGPSCallback(%f, %f, %f, %f, %f)",
                                        loc.getLatitude(),
                                        loc.getLongitude(),
                                        loc.getAltitude(),
                                        loc.getAccuracy(),
                                        loc.getTime()
                                    );
                                    runOnUiThread(() -> webView.evaluateJavascript(js, null));
                                }
                                @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
                                @Override public void onProviderEnabled(String provider) {}
                                @Override public void onProviderDisabled(String provider) {}
                            }, null);
                    }
                }
            } catch (Exception e) {
                runOnUiThread(() -> webView.evaluateJavascript(
                    "window._nativeGPSError('GPS alınamadı: " + e.getMessage() + "')", null));
            }
        }

        @JavascriptInterface
        public String getVersion() {
            return "1.0.0";
        }

        @JavascriptInterface
        public String getPlatform() {
            return "android";
        }
    }
}