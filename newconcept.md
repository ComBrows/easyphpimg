** Fact

1. one images folder for one customers, contains bunch of image files with variatif size from 1mb to 10mb
2. this folder not every day get a new image, but some time maybe 
3. if changed,  within 24H is acceptable
4. if md5 for folder work, is better to tiger rescan the folder and store it in images.json

** new concept
*** backend (php)
1. check whereever the images.json file exists of no
2. do scan dir and put in the cache if not exists
3. check md5 folder is changing or no, if changing do scan dir again
4. if no, no need toscan
5. since the server already have feature gzip, so images.json will be tranfer to the client, 50M can reduce to 8~10mb (equal one size of picture)

*** frontend (js,webix.loadash)
6. when touch landing page please add this screen
```
--------------------------------------------------
| Please wait, Loading folder...                 |
+------------------------------------------------+
| Folder size : 9,999 G.                         |
| Files count : 9,999 files                      |
| Date Cache  : yyyy-mm-dd                       |
|                                                |
+------------------------------------------------+
| ******* <--- bar graph                         |
+------------------------------------------------+
```
7. after json completed receive, do calc to generate how many pages, and create tree data for sidebar menu
8. draw layout
9. fetch 1st page with only showin images, and do repeatdly when user click next page or any page
10. search base on images.json that store in client browser, no need backend to handle it.
11. less interactive with the server, the server just feed by one on one file thet client requested
12. optimize all computate in client browser
13. using all feature ui webix, loadash, minimize css