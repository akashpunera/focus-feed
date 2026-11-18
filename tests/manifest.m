#import <Foundation/Foundation.h>
#import <WebKit/WebKit.h>

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 2) return 2;
        NSURL *url = [NSURL fileURLWithPath:@(argv[1])];
        __block BOOL done = NO;
        __block BOOL passed = NO;
        [WKWebExtension extensionWithAppExtensionBundle:[NSBundle bundleWithURL:url]
                                     completionHandler:^(WKWebExtension *extension, NSError *error) {
            if (!extension || extension.errors.count) {
                NSLog(@"Could not load extension manifest: %@ %@", error, extension.errors);
            } else {
                WKWebExtensionController *controller = [[WKWebExtensionController alloc]
                    initWithConfiguration:WKWebExtensionControllerConfiguration.nonPersistentConfiguration];
                WKWebExtensionContext *context = [[WKWebExtensionContext alloc] initForExtension:extension];
                NSError *failure;
                passed = [controller loadExtensionContext:context error:&failure];
                if (!passed) NSLog(@"Could not load extension context: %@", failure);
            }
            done = YES;
        }];
        NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:5];
        while (!done && deadline.timeIntervalSinceNow > 0)
            [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
        if (passed) puts("PASS WebKit loaded the packaged extension context");
        return passed ? 0 : 1;
    }
}
