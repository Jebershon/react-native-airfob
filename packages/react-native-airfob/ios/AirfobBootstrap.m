#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

#if __has_include("react_native_airfob-Swift.h")
#import "react_native_airfob-Swift.h"
#else
#import <react_native_airfob/react_native_airfob-Swift.h>
#endif

/**
 * iOS equivalent of androidx.startup on Android.
 *
 * Starts the Airfob core at app launch without the host app editing its
 * AppDelegate — a Mendix Native Template gets this by adding the dependency and
 * nothing else. The load-time observer registration is cheap; the actual boot is
 * guarded and does nothing on an unenrolled device.
 */
@interface AirfobBootstrap : NSObject
@end

@implementation AirfobBootstrap

+ (void)load
{
  [[NSNotificationCenter defaultCenter]
      addObserver:self
         selector:@selector(applicationDidFinishLaunching:)
             name:UIApplicationDidFinishLaunchingNotification
           object:nil];
}

+ (void)applicationDidFinishLaunching:(NSNotification *)notification
{
  [[AirfobCore shared] bootIfEnrolled];
}

@end
